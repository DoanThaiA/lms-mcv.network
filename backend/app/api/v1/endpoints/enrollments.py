"""Giao khoá học cho nhân viên, theo dõi tiến độ (quyền enrollment.manage / report.view)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Numeric, Select, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, require
from app.db.session import get_db
from app.models import Course, Enrollment, LessonProgress, User
from app.models.enums import CourseStatus, EnrollmentSource, EnrollmentStatus, UserStatus
from app.schemas.common import Page
from app.schemas.employee import EmployeeBrief
from app.schemas.enrollment import (
    AssignResult,
    CourseProgress,
    CourseReport,
    EnrollmentAssign,
    EnrollmentDetail,
    EnrollmentUpdate,
    LessonProgressOut,
)
from app.services.common import not_found, unprocessable
from app.services.learning import enrollment_out, get_course

router = APIRouter()
course_router = APIRouter()
report_router = APIRouter()


async def get_managed_enrollment(db: AsyncSession, principal: Principal, enrollment_id: int) -> Enrollment:
    enrollment = await db.get(Enrollment, enrollment_id)
    if enrollment is None or enrollment.company_id != principal.company.id:
        raise not_found("ghi danh")
    return enrollment


async def course_progress(db: AsyncSession, enrollment: Enrollment) -> CourseProgress:
    rows = await db.scalars(
        select(LessonProgress).where(LessonProgress.enrollment_id == enrollment.id).order_by(LessonProgress.lesson_id)
    )
    return CourseProgress(
        enrollment=enrollment_out(enrollment), lessons=[LessonProgressOut.model_validate(r) for r in rows]
    )


def overdue_condition():
    return and_(Enrollment.due_date < func.current_date(), Enrollment.status != EnrollmentStatus.completed)


@course_router.post(
    "",
    response_model=AssignResult,
    status_code=status.HTTP_201_CREATED,
    summary="Giao khoá học cho nhiều nhân viên (bỏ qua người đã ghi danh)",
)
async def assign_course(
    course_id: int,
    body: EnrollmentAssign,
    principal: Principal = Depends(require("enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    if course.status != CourseStatus.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chỉ giao được khoá học đang phát hành")
    if body.due_date is not None and body.due_date < date.today():
        raise unprocessable("Hạn hoàn thành không được ở quá khứ")
    user_ids = list(dict.fromkeys(body.user_ids))
    valid = set(
        await db.scalars(
            select(User.id).where(
                User.id.in_(user_ids),
                User.company_id == course.company_id,
                User.employee_code.is_not(None),
                User.deleted_at.is_(None),
                User.status == UserStatus.active,
            )
        )
    )
    if invalid := [u for u in user_ids if u not in valid]:
        raise unprocessable(f"Không phải nhân viên đang hoạt động của công ty: {invalid}")
    existing = set(
        await db.scalars(
            select(Enrollment.user_id).where(Enrollment.course_id == course.id, Enrollment.user_id.in_(user_ids))
        )
    )
    created = [
        Enrollment(
            company_id=course.company_id,
            course_id=course.id,
            user_id=uid,
            source=EnrollmentSource.assigned,
            assigned_by=principal.user.id,
            due_date=body.due_date,
        )
        for uid in user_ids
        if uid not in existing
    ]
    db.add_all(created)
    await db.commit()
    return AssignResult(
        created=[enrollment_out(e) for e in created], skipped_user_ids=[u for u in user_ids if u in existing]
    )


def enrollment_query(principal: Principal) -> Select:
    return (
        select(Enrollment, User, Course.code, Course.title)
        .join(User, User.id == Enrollment.user_id)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.company_id == principal.company.id, Course.deleted_at.is_(None))
    )


@router.get("", response_model=Page[EnrollmentDetail], summary="Danh sách ghi danh / tiến độ học của nhân viên")
async def list_enrollments(
    course_id: int | None = None,
    user_id: int | None = None,
    status_: EnrollmentStatus | None = Query(None, alias="status"),
    overdue: bool | None = Query(None, description="true: chỉ ghi danh quá hạn chưa hoàn thành"),
    q: str | None = Query(None, description="Tìm theo mã / tên nhân viên"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    principal: Principal = Depends(require("report.view")),
    db: AsyncSession = Depends(get_db),
):
    stmt = enrollment_query(principal).order_by(Enrollment.created_at.desc(), Enrollment.id.desc())
    if course_id is not None:
        stmt = stmt.where(Enrollment.course_id == course_id)
    if user_id is not None:
        stmt = stmt.where(Enrollment.user_id == user_id)
    if status_:
        stmt = stmt.where(Enrollment.status == status_)
    if overdue is not None:
        cond = overdue_condition()
        stmt = stmt.where(cond if overdue else ~cond | Enrollment.due_date.is_(None))
    if q:
        stmt = stmt.where(or_(User.employee_code.ilike(f"%{q}%"), User.full_name.ilike(f"%{q}%")))
    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await db.execute(stmt.limit(size).offset((page - 1) * size))).all()
    items = [
        enrollment_out(
            e,
            EnrollmentDetail,
            employee=EmployeeBrief.model_validate(u),
            course_code=code,
            course_title=title,
        )
        for e, u, code, title in rows
    ]
    return {"items": items, "total": total or 0, "page": page, "size": size}


@router.get("/{enrollment_id}/progress", response_model=CourseProgress, summary="Tiến độ từng bài của một nhân viên")
async def get_enrollment_progress(
    enrollment_id: int,
    principal: Principal = Depends(require("report.view")),
    db: AsyncSession = Depends(get_db),
):
    return await course_progress(db, await get_managed_enrollment(db, principal, enrollment_id))


@router.patch("/{enrollment_id}", response_model=CourseProgress, summary="Đổi hạn hoàn thành")
async def update_enrollment(
    enrollment_id: int,
    body: EnrollmentUpdate,
    principal: Principal = Depends(require("enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    enrollment = await get_managed_enrollment(db, principal, enrollment_id)
    if "due_date" in body.model_fields_set:
        enrollment.due_date = body.due_date
    await db.commit()
    return await course_progress(db, enrollment)


@router.delete("/{enrollment_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Huỷ ghi danh (xoá cả tiến độ)")
async def delete_enrollment(
    enrollment_id: int,
    principal: Principal = Depends(require("enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(await get_managed_enrollment(db, principal, enrollment_id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@report_router.get(
    "/courses", response_model=list[CourseReport], summary="Thống kê ghi danh / hoàn thành theo khoá học"
)
async def course_report(
    status_: CourseStatus | None = Query(None, alias="status"),
    principal: Principal = Depends(require("report.view")),
    db: AsyncSession = Depends(get_db),
):
    def count_if(cond):
        return func.count(Enrollment.id).filter(cond)

    enrolled = func.count(Enrollment.id)
    completed = count_if(Enrollment.status == EnrollmentStatus.completed)
    stmt = (
        select(
            Course.id,
            Course.code,
            Course.title,
            Course.status,
            enrolled.label("enrolled"),
            count_if(Enrollment.status == EnrollmentStatus.not_started).label("not_started"),
            count_if(Enrollment.status == EnrollmentStatus.in_progress).label("in_progress"),
            completed.label("completed"),
            count_if(overdue_condition()).label("overdue"),
            func.coalesce(func.round(cast(completed * 100, Numeric) / func.nullif(enrolled, 0), 2), 0).label("rate"),
        )
        .outerjoin(Enrollment, Enrollment.course_id == Course.id)
        .where(Course.company_id == principal.company.id, Course.deleted_at.is_(None))
        .group_by(Course.id)
        .order_by(Course.code)
    )
    if status_:
        stmt = stmt.where(Course.status == status_)
    return [
        CourseReport(
            course_id=r.id,
            code=r.code,
            title=r.title,
            status=r.status,
            enrolled=r.enrolled,
            not_started=r.not_started,
            in_progress=r.in_progress,
            completed=r.completed,
            overdue=r.overdue,
            completion_rate=r.rate,
        )
        for r in (await db.execute(stmt)).all()
    ]

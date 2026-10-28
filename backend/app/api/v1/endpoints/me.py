"""Học viên: khoá học của tôi, tự đăng ký, ghi nhận tiến độ bài học."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal
from app.api.v1.endpoints.enrollments import course_progress
from app.api.v1.endpoints.lessons import get_lesson
from app.db.session import get_db
from app.models import Course, Enrollment, LessonProgress
from app.models.enums import CourseStatus, EnrollmentSource, EnrollmentStatus, EnrollMode
from app.schemas.course import CourseOut
from app.schemas.enrollment import CourseProgress, EnrollmentOut, LessonProgressIn, MyCourse
from app.services.common import not_found
from app.services.learning import enrollment_out, get_course, get_enrollment, refresh_progress

router = APIRouter()


async def my_enrollment(db: AsyncSession, principal: Principal, course: Course) -> Enrollment:
    enrollment = await get_enrollment(db, course.id, principal.user.id)
    if enrollment is None or course.status == CourseStatus.draft:
        raise not_found("khoá học đã ghi danh")
    return enrollment


@router.get("/courses", response_model=list[MyCourse], summary="Khoá học tôi đã ghi danh / được giao")
async def my_courses(
    status_: EnrollmentStatus | None = Query(None, alias="status"),
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Enrollment, Course)
        .join(Course, Course.id == Enrollment.course_id)
        .where(
            Enrollment.user_id == principal.user.id,
            Course.deleted_at.is_(None),
            Course.status != CourseStatus.draft,
        )
        # Chưa xong lên trước, hạn gần nhất lên đầu
        .order_by(
            (Enrollment.status == EnrollmentStatus.completed).asc(),
            Enrollment.due_date.asc().nulls_last(),
            Enrollment.created_at.desc(),
        )
    )
    if status_:
        stmt = stmt.where(Enrollment.status == status_)
    rows = (await db.execute(stmt)).all()
    return [enrollment_out(e, MyCourse, course=CourseOut.model_validate(c)) for e, c in rows]


@router.post(
    "/courses/{course_id}/enroll",
    response_model=EnrollmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Tự đăng ký khoá học mở",
)
async def self_enroll(
    course_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    if course.status != CourseStatus.published or course.enroll_mode != EnrollMode.open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Khoá học không mở đăng ký")
    if await get_enrollment(db, course.id, principal.user.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bạn đã ghi danh khoá học này")
    enrollment = Enrollment(
        company_id=course.company_id, course_id=course.id, user_id=principal.user.id, source=EnrollmentSource.self
    )
    db.add(enrollment)
    await db.commit()
    return enrollment_out(enrollment)


@router.get("/courses/{course_id}/progress", response_model=CourseProgress, summary="Tiến độ của tôi trong khoá học")
async def my_progress(
    course_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    return await course_progress(db, await my_enrollment(db, principal, course))


@router.post(
    "/courses/{course_id}/lessons/{lesson_id}/progress",
    response_model=CourseProgress,
    summary="Ghi nhận học bài: vị trí xem video, đánh dấu hoàn thành",
)
async def record_progress(
    course_id: int,
    lesson_id: int,
    body: LessonProgressIn,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    enrollment = await my_enrollment(db, principal, course)
    lesson = await get_lesson(db, course, lesson_id)

    values: dict = {"enrollment_id": enrollment.id, "course_id": course.id, "lesson_id": lesson.id}
    if body.position_seconds is not None:
        values["last_position_seconds"] = body.position_seconds
    if body.completed:
        values["completed_at"] = func.now()
    stmt = insert(LessonProgress).values(**values)
    updates = {k: stmt.excluded[k] for k in ("last_position_seconds",) if k in values}
    if body.completed:  # đã hoàn thành thì giữ thời điểm hoàn thành đầu tiên
        updates["completed_at"] = func.coalesce(LessonProgress.completed_at, stmt.excluded.completed_at)
    if updates:
        stmt = stmt.on_conflict_do_update(index_elements=["enrollment_id", "lesson_id"], set_=updates)
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=["enrollment_id", "lesson_id"])
    await db.execute(stmt)

    enrollment.last_accessed_at = func.now()
    await db.flush()
    await refresh_progress(db, enrollment_id=enrollment.id)
    await db.commit()
    await db.refresh(enrollment)
    return await course_progress(db, enrollment)

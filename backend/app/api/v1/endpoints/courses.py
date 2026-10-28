from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal, require
from app.api.v1.endpoints.categories import ensure_category
from app.db.session import get_db
from app.models import Course, CourseDocument, Document, Enrollment, Lesson
from app.models.enums import CourseStatus, EnrollMode
from app.schemas.common import Page
from app.schemas.course import (
    CourseCreate,
    CourseDetail,
    CourseDocumentsSet,
    CourseOut,
    CourseStatusChange,
    CourseUpdate,
    DocumentOut,
    LessonOut,
)
from app.services.common import apply_update, paginate, unprocessable
from app.services.learning import get_course, get_visible_course

router = APIRouter()

# Chuyển trạng thái khoá học hợp lệ
TRANSITIONS: dict[CourseStatus, set[CourseStatus]] = {
    CourseStatus.draft: {CourseStatus.published},
    CourseStatus.published: {CourseStatus.archived, CourseStatus.draft},
    CourseStatus.archived: {CourseStatus.published},
}


async def course_detail(db: AsyncSession, course: Course) -> CourseDetail:
    lessons = await db.scalars(
        select(Lesson).where(Lesson.course_id == course.id).order_by(Lesson.sort_order, Lesson.id)
    )
    documents = await db.scalars(
        select(Document)
        .join(CourseDocument, CourseDocument.document_id == Document.id)
        .where(CourseDocument.course_id == course.id, Document.deleted_at.is_(None))
        .order_by(CourseDocument.sort_order, Document.id)
    )
    return CourseDetail(
        **CourseOut.model_validate(course).model_dump(),
        description=course.description,
        created_by=course.created_by,
        lessons=[LessonOut.model_validate(x) for x in lessons],
        documents=[DocumentOut.model_validate(x) for x in documents],
    )


@router.get(
    "",
    response_model=Page[CourseOut],
    summary="Danh mục khoá học (học viên: khoá đã phát hành mở đăng ký hoặc được giao; người soạn: tất cả)",
)
async def list_courses(
    q: str | None = Query(None, description="Tìm theo mã, tên khoá học"),
    category_id: int | None = None,
    status_: CourseStatus | None = Query(None, alias="status"),
    enroll_mode: EnrollMode | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Course)
        .where(Course.company_id == principal.company.id, Course.deleted_at.is_(None))
        .order_by(Course.created_at.desc(), Course.id.desc())
    )
    if not principal.can("content.manage"):
        enrolled = exists().where(Enrollment.course_id == Course.id, Enrollment.user_id == principal.user.id)
        stmt = stmt.where(Course.status == CourseStatus.published, or_(Course.enroll_mode == EnrollMode.open, enrolled))
    elif status_:
        stmt = stmt.where(Course.status == status_)
    if q:
        stmt = stmt.where(or_(Course.code.ilike(f"%{q}%"), Course.title.ilike(f"%{q}%")))
    if category_id is not None:
        stmt = stmt.where(Course.category_id == category_id)
    if enroll_mode:
        stmt = stmt.where(Course.enroll_mode == enroll_mode)
    return await paginate(db, stmt, page, size)


@router.post("", response_model=CourseDetail, status_code=status.HTTP_201_CREATED)
async def create_course(
    body: CourseCreate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    await ensure_category(db, principal, body.category_id)
    course = Course(**body.model_dump(), company_id=principal.company.id, created_by=principal.user.id)
    db.add(course)
    await db.commit()
    return await course_detail(db, course)


@router.get("/{course_id}", response_model=CourseDetail, summary="Chi tiết khoá học + danh sách bài + tài liệu")
async def get_course_detail(
    course_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    return await course_detail(db, await get_visible_course(db, principal, course_id))


@router.patch("/{course_id}", response_model=CourseDetail)
async def update_course(
    course_id: int,
    body: CourseUpdate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    if "category_id" in body.model_fields_set:
        await ensure_category(db, principal, body.category_id)
    for field in ("code", "title", "enroll_mode"):
        if field in body.model_fields_set and getattr(body, field) is None:
            raise unprocessable(f"{field} không được để trống")
    apply_update(course, body)
    await db.commit()
    return await course_detail(db, course)


@router.post(
    "/{course_id}/status",
    response_model=CourseDetail,
    summary="Phát hành / lưu trữ / chuyển về nháp (về nháp khi chưa ai ghi danh)",
)
async def change_course_status(
    course_id: int,
    body: CourseStatusChange,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    if body.status not in TRANSITIONS[course.status]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Không chuyển được từ '{course.status}' sang '{body.status}'",
        )
    if body.status == CourseStatus.published:
        has_lesson = await db.scalar(select(exists().where(Lesson.course_id == course.id)))
        if not has_lesson:
            raise unprocessable("Khoá học cần ít nhất một bài học trước khi phát hành")
        course.published_at = course.published_at or func.now()
    if body.status == CourseStatus.draft:
        has_enrollment = await db.scalar(select(exists().where(Enrollment.course_id == course.id)))
        if has_enrollment:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Khoá học đã có người ghi danh, chỉ lưu trữ được"
            )
    course.status = body.status
    await db.commit()
    await db.refresh(course)
    return await course_detail(db, course)


@router.delete(
    "/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Xoá khoá học (xoá mềm; khoá đang phát hành phải lưu trữ trước)",
)
async def delete_course(
    course_id: int,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    if course.status == CourseStatus.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lưu trữ khoá học trước khi xoá")
    course.deleted_at = func.now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{course_id}/documents", response_model=CourseDetail, summary="Đặt tài liệu tham khảo của khoá học")
async def set_course_documents(
    course_id: int,
    body: CourseDocumentsSet,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    ids = list(dict.fromkeys(body.document_ids))
    if ids:
        found = set(
            await db.scalars(
                select(Document.id).where(
                    Document.id.in_(ids), Document.company_id == course.company_id, Document.deleted_at.is_(None)
                )
            )
        )
        if missing := [i for i in ids if i not in found]:
            raise unprocessable(f"Tài liệu không tồn tại: {missing}")
    await db.execute(delete(CourseDocument).where(CourseDocument.course_id == course.id))
    db.add_all(
        CourseDocument(company_id=course.company_id, course_id=course.id, document_id=doc_id, sort_order=i)
        for i, doc_id in enumerate(ids)
    )
    await db.commit()
    return await course_detail(db, course)

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal, require
from app.db.session import get_db
from app.models import Course, Document, Lesson
from app.schemas.course import (
    LessonCreate,
    LessonDetail,
    LessonOrder,
    LessonOut,
    LessonUpdate,
    check_lesson_content,
)
from app.services.common import not_found, unprocessable
from app.services.learning import (
    document_detail,
    get_course,
    get_enrollment,
    get_visible_course,
    refresh_progress,
)

router = APIRouter()


async def get_lesson(db: AsyncSession, course: Course, lesson_id: int) -> Lesson:
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None or lesson.course_id != course.id:
        raise not_found("bài học")
    return lesson


async def ensure_document(db: AsyncSession, course: Course, document_id: int | None) -> None:
    if document_id is None:
        return
    doc = await db.get(Document, document_id)
    if doc is None or doc.deleted_at is not None or doc.company_id != course.company_id:
        raise unprocessable(f"Tài liệu id={document_id} không tồn tại")


async def lesson_detail(db: AsyncSession, lesson: Lesson) -> LessonDetail:
    doc = await db.get(Document, lesson.document_id) if lesson.document_id else None
    return LessonDetail(
        **LessonOut.model_validate(lesson).model_dump(),
        body=lesson.body,
        external_url=lesson.external_url,
        document_id=lesson.document_id,
        document=document_detail(doc) if doc is not None and doc.deleted_at is None else None,
    )


@router.get(
    "/{lesson_id}",
    response_model=LessonDetail,
    summary="Nội dung bài học (học viên phải ghi danh khoá học; link file hết hạn sau 1 giờ)",
)
async def get_lesson_detail(
    course_id: int,
    lesson_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course = await get_visible_course(db, principal, course_id)
    lesson = await get_lesson(db, course, lesson_id)
    if not principal.can("content.manage"):
        enrollment = await get_enrollment(db, course.id, principal.user.id)
        if enrollment is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Đăng ký khoá học trước khi học")
        enrollment.last_accessed_at = func.now()
        await db.commit()
    return await lesson_detail(db, lesson)


@router.post("", response_model=LessonDetail, status_code=status.HTTP_201_CREATED)
async def create_lesson(
    course_id: int,
    body: LessonCreate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    await ensure_document(db, course, body.document_id)
    sort_order = body.sort_order
    if sort_order is None:
        sort_order = (await db.scalar(select(func.max(Lesson.sort_order)).where(Lesson.course_id == course.id))) or 0
        sort_order += 1
    data = body.model_dump(exclude={"sort_order", "external_url"})
    lesson = Lesson(
        **data,
        external_url=str(body.external_url) if body.external_url else None,
        company_id=course.company_id,
        course_id=course.id,
        sort_order=sort_order,
    )
    db.add(lesson)
    await db.flush()
    await refresh_progress(db, course_id=course.id)
    await db.commit()
    return await lesson_detail(db, lesson)


@router.patch("/{lesson_id}", response_model=LessonDetail)
async def update_lesson(
    course_id: int,
    lesson_id: int,
    body: LessonUpdate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    lesson = await get_lesson(db, course, lesson_id)
    values = body.model_dump(exclude_unset=True)
    for field in ("title", "content_type", "is_required"):
        if field in values and values[field] is None:
            raise unprocessable(f"{field} không được để trống")
    if "external_url" in values and values["external_url"] is not None:
        values["external_url"] = str(values["external_url"])
    if "document_id" in values:
        await ensure_document(db, course, values["document_id"])
    merged = {f: values.get(f, getattr(lesson, f)) for f in ("content_type", "body", "external_url", "document_id")}
    try:
        check_lesson_content(merged["content_type"], merged["body"], merged["external_url"], merged["document_id"])
    except ValueError as exc:
        raise unprocessable(str(exc)) from exc
    for field, value in values.items():
        setattr(lesson, field, value)
    await db.flush()
    if "is_required" in values:
        await refresh_progress(db, course_id=course.id)
    await db.commit()
    return await lesson_detail(db, lesson)


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Xoá bài học (xoá cả tiến độ bài)")
async def delete_lesson(
    course_id: int,
    lesson_id: int,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    await db.delete(await get_lesson(db, course, lesson_id))
    await db.flush()
    await refresh_progress(db, course_id=course.id)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/order", response_model=list[LessonOut], summary="Sắp xếp lại thứ tự bài học")
async def reorder_lessons(
    course_id: int,
    body: LessonOrder,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    current = set(await db.scalars(select(Lesson.id).where(Lesson.course_id == course.id)))
    if set(body.lesson_ids) != current or len(body.lesson_ids) != len(current):
        raise unprocessable("lesson_ids phải gồm đúng toàn bộ bài học của khoá, mỗi bài một lần")
    for index, lid in enumerate(body.lesson_ids, start=1):
        await db.execute(update(Lesson).where(Lesson.id == lid).values(sort_order=index))
    await db.commit()
    rows = await db.scalars(
        select(Lesson)
        .where(Lesson.course_id == course.id)
        .order_by(Lesson.sort_order, Lesson.id)
        .execution_options(populate_existing=True)
    )
    return rows.all()

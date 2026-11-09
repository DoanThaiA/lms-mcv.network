from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal, require
from app.db.session import get_db
from app.models import Course, Document, Lesson, LessonDocument
from app.models.enums import LessonKind, LessonType
from app.schemas.course import (
    STANDARD_ONLY,
    LessonBulkCreate,
    LessonCreate,
    LessonDetail,
    LessonOrder,
    LessonOut,
    LessonUpdate,
    QuizOut,
    QuizQuestionOut,
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


async def ensure_documents(db: AsyncSession, course: Course, document_ids: list[int]) -> None:
    if not document_ids:
        return
    found = set(
        await db.scalars(
            select(Document.id).where(
                Document.id.in_(document_ids),
                Document.company_id == course.company_id,
                Document.deleted_at.is_(None),
            )
        )
    )
    if missing := [d for d in document_ids if d not in found]:
        raise unprocessable(f"Tài liệu không tồn tại: {missing}")


async def set_practice_documents(db: AsyncSession, lesson: Lesson, document_ids: list[int]) -> None:
    """Thay toàn bộ tài liệu thực hành của bài theo thứ tự mới."""
    await db.execute(delete(LessonDocument).where(LessonDocument.lesson_id == lesson.id))
    db.add_all(
        LessonDocument(company_id=lesson.company_id, lesson_id=lesson.id, document_id=did, sort_order=i)
        for i, did in enumerate(document_ids, start=1)
    )


def quiz_out(quiz: dict | None, *, include_answers: bool) -> QuizOut | None:
    """Học viên không nhận đáp án / giải thích: chấm trên máy chủ qua POST /me/courses/.../quiz."""
    if not quiz:
        return None
    return QuizOut(
        pass_score=quiz.get("pass_score"),
        must_correct=quiz.get("must_correct", []),
        questions=[
            QuizQuestionOut(
                question=q["question"],
                options=q["options"],
                answer=q["answer"] if include_answers else None,
                explanation=q.get("explanation") if include_answers else None,
            )
            for q in quiz.get("questions", [])
        ],
    )


async def lesson_detail(db: AsyncSession, lesson: Lesson, *, include_answers: bool = True) -> LessonDetail:
    doc = await db.get(Document, lesson.document_id) if lesson.document_id else None
    practice = await db.scalars(
        select(Document)
        .join(LessonDocument, LessonDocument.document_id == Document.id)
        .where(LessonDocument.lesson_id == lesson.id, Document.deleted_at.is_(None))
        .order_by(LessonDocument.sort_order, Document.id)
    )
    return LessonDetail(
        **LessonOut.model_validate(lesson).model_dump(),
        body=lesson.body,
        external_url=lesson.external_url,
        document_id=lesson.document_id,
        document=document_detail(doc) if doc is not None and doc.deleted_at is None else None,
        goals=lesson.goals or [],
        video_minutes=lesson.video_minutes,
        quiz=quiz_out(lesson.quiz, include_answers=include_answers),
        assignment=lesson.assignment,
        practice_documents=[document_detail(d) for d in practice],
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
    return await lesson_detail(db, lesson, include_answers=principal.can("content.manage"))


async def next_sort_order(db: AsyncSession, course: Course) -> int:
    return ((await db.scalar(select(func.max(Lesson.sort_order)).where(Lesson.course_id == course.id))) or 0) + 1


async def add_lesson(db: AsyncSession, course: Course, body: LessonCreate, sort_order: int) -> Lesson:
    await ensure_document(db, course, body.document_id)
    await ensure_documents(db, course, body.practice_document_ids)
    # mode="json": quiz / assignment thành dict thuần để lưu jsonb
    data = body.model_dump(exclude={"sort_order", "external_url", "practice_document_ids"}, mode="json")
    lesson = Lesson(
        **data,
        external_url=str(body.external_url) if body.external_url else None,
        company_id=course.company_id,
        course_id=course.id,
        sort_order=sort_order,
    )
    db.add(lesson)
    await db.flush()
    await set_practice_documents(db, lesson, body.practice_document_ids)
    await db.flush()
    return lesson


@router.post("", response_model=LessonDetail, status_code=status.HTTP_201_CREATED)
async def create_lesson(
    course_id: int,
    body: LessonCreate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    sort_order = body.sort_order if body.sort_order is not None else await next_sort_order(db, course)
    lesson = await add_lesson(db, course, body, sort_order)
    await refresh_progress(db, course_id=course.id)
    await db.commit()
    return await lesson_detail(db, lesson)


@router.post(
    "/bulk",
    response_model=list[LessonOut],
    status_code=status.HTTP_201_CREATED,
    summary="Thêm nhiều bài vào cuối khoá học theo thứ tự gửi lên (lỗi một bài thì không thêm bài nào)",
)
async def create_lessons_bulk(
    course_id: int,
    body: LessonBulkCreate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    start = await next_sort_order(db, course)
    created = []
    for index, item in enumerate(body.lessons):
        try:
            created.append(await add_lesson(db, course, item, start + index))
        except HTTPException as exc:
            raise unprocessable(f"Bài {index + 1} ({item.title}): {exc.detail}") from exc
    await refresh_progress(db, course_id=course.id)
    await db.commit()
    return created


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
    values = body.model_dump(exclude_unset=True, mode="json")
    for field in ("title", "content_type", "is_required"):
        if field in values and values[field] is None:
            raise unprocessable(f"{field} không được để trống")
    if "goals" in values and values["goals"] is None:
        values["goals"] = []
    if "document_id" in values:
        await ensure_document(db, course, values["document_id"])
    practice_ids = values.pop("practice_document_ids", None)
    fields = ("content_type", "body", "external_url", "document_id", "goals", *STANDARD_ONLY)
    merged = {f: values.get(f, getattr(lesson, f)) for f in fields}
    if merged["content_type"] != LessonType.standard:
        # Loại bài khác: bỏ phần riêng của bài học chuẩn
        values.update({f: None for f in STANDARD_ONLY}, goals=[])
        practice_ids = []
    else:
        # Chỉ giữ câu hỏi / yêu cầu nộp bài đúng với dạng bài
        if merged["lesson_kind"] != LessonKind.quiz:
            values["quiz"] = None
        if merged["lesson_kind"] != LessonKind.practice:
            values["assignment"] = None
    try:
        check_lesson_content(merged)
    except ValueError as exc:
        raise unprocessable(str(exc)) from exc
    if practice_ids is not None:
        await ensure_documents(db, course, practice_ids)
        await set_practice_documents(db, lesson, practice_ids)
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

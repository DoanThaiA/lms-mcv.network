"""Học viên: khoá học của tôi, tự đăng ký, ghi nhận tiến độ bài học, làm câu hỏi kiểm tra, nộp bài thực hành."""

import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal
from app.api.v1.endpoints.enrollments import course_progress
from app.api.v1.endpoints.lessons import get_lesson
from app.core.config import settings
from app.db.session import get_db
from app.models import Course, Document, Enrollment, Lesson, LessonProgress, LessonSubmission
from app.models.enums import CourseStatus, EnrollmentSource, EnrollmentStatus, EnrollMode, LessonKind, LessonType
from app.schemas.course import CourseOut
from app.schemas.enrollment import (
    CourseProgress,
    EnrollmentOut,
    LessonProgressIn,
    MyCourse,
    QuizAttemptIn,
    QuizQuestionResult,
    QuizResult,
    SubmissionOut,
    SubmissionResult,
)
from app.services import file_storage
from app.services.common import not_found, unprocessable
from app.services.learning import enrollment_out, get_course, get_enrollment, refresh_progress, submission_out

router = APIRouter()

LINK_PATTERN = re.compile(r"^https?://\S+\.\S+$")
MIN_TEXT_SUBMISSION = 20  # ký tự, khi bài cho nộp bằng nội dung gõ vào ô ghi chú


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


async def has_video(db: AsyncSession, lesson: Lesson) -> bool:
    if lesson.external_url:
        return True
    if lesson.document_id is None:
        return False
    doc = await db.get(Document, lesson.document_id)
    return doc is not None and doc.deleted_at is None


async def has_submission(db: AsyncSession, enrollment: Enrollment, lesson: Lesson) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(LessonSubmission.enrollment_id == enrollment.id, LessonSubmission.lesson_id == lesson.id)
            )
        )
    )


async def check_can_complete(db: AsyncSession, enrollment: Enrollment, lesson: Lesson, *, video_now: bool) -> None:
    """Bài học chuẩn chỉ hoàn thành khi đủ điều kiện theo dạng bài:
    thực hành = đã nộp bài; lý thuyết = xem hết video (nếu có); kiểm tra = xem hết video + trả lời đạt."""
    if lesson.content_type != LessonType.standard:
        return
    progress = await db.get(LessonProgress, (enrollment.id, lesson.id))
    missing: list[str] = []
    if lesson.lesson_kind == LessonKind.practice:
        if not await has_submission(db, enrollment, lesson):
            missing.append("nộp bài")
    else:
        video_done = video_now or (progress is not None and progress.video_completed_at is not None)
        if not video_done and await has_video(db, lesson):
            missing.append("xem hết video")
        if lesson.lesson_kind == LessonKind.quiz and (progress is None or progress.quiz_passed_at is None):
            missing.append("trả lời đạt câu hỏi kiểm tra")
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Chưa đủ điều kiện hoàn thành bài: cần {', '.join(missing)}"
        )


async def mark_completed(db: AsyncSession, enrollment: Enrollment, course: Course, lesson: Lesson) -> None:
    stmt = insert(LessonProgress).values(
        enrollment_id=enrollment.id, course_id=course.id, lesson_id=lesson.id, completed_at=func.now()
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["enrollment_id", "lesson_id"],
            set_={"completed_at": func.coalesce(LessonProgress.completed_at, stmt.excluded.completed_at)},
        )
    )


async def after_progress(db: AsyncSession, enrollment: Enrollment) -> CourseProgress:
    enrollment.last_accessed_at = func.now()
    await db.flush()
    await refresh_progress(db, enrollment_id=enrollment.id)
    await db.commit()
    await db.refresh(enrollment)
    return await course_progress(db, enrollment)


@router.post(
    "/courses/{course_id}/lessons/{lesson_id}/progress",
    response_model=CourseProgress,
    summary="Ghi nhận học bài: vị trí xem video, đã xem hết video, đánh dấu hoàn thành",
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
    if body.completed:
        await check_can_complete(db, enrollment, lesson, video_now=body.video_completed)

    values: dict = {"enrollment_id": enrollment.id, "course_id": course.id, "lesson_id": lesson.id}
    if body.position_seconds is not None:
        values["last_position_seconds"] = body.position_seconds
    if body.video_completed:
        values["video_completed_at"] = func.now()
    if body.completed:
        values["completed_at"] = func.now()
    stmt = insert(LessonProgress).values(**values)
    updates = {k: stmt.excluded[k] for k in ("last_position_seconds",) if k in values}
    # Giữ thời điểm đầu tiên xem hết video / hoàn thành
    for k in ("video_completed_at", "completed_at"):
        if k in values:
            updates[k] = func.coalesce(getattr(LessonProgress, k), stmt.excluded[k])
    if updates:
        stmt = stmt.on_conflict_do_update(index_elements=["enrollment_id", "lesson_id"], set_=updates)
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=["enrollment_id", "lesson_id"])
    await db.execute(stmt)
    return await after_progress(db, enrollment)


@router.post(
    "/courses/{course_id}/lessons/{lesson_id}/quiz",
    response_model=QuizResult,
    summary="Nộp câu trả lời kiểm tra (chấm trên máy chủ, làm lại được; đạt một lần là đạt)",
)
async def submit_quiz(
    course_id: int,
    lesson_id: int,
    body: QuizAttemptIn,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course = await get_course(db, principal, course_id)
    enrollment = await my_enrollment(db, principal, course)
    lesson = await get_lesson(db, course, lesson_id)
    quiz = lesson.quiz if lesson.content_type == LessonType.standard else None
    if not quiz:
        raise not_found("câu hỏi kiểm tra của bài học")
    questions = quiz["questions"]
    if len(body.answers) != len(questions):
        raise unprocessable(f"Cần trả lời đủ {len(questions)} câu")
    results = [
        QuizQuestionResult(correct=answer == q["answer"], explanation=q.get("explanation"))
        for answer, q in zip(body.answers, questions, strict=True)
    ]
    score = sum(r.correct for r in results)
    need = quiz.get("pass_score") or len(questions)
    must = quiz.get("must_correct", [])
    passed = score >= need and all(results[i].correct for i in must if i < len(results))

    stmt = insert(LessonProgress).values(
        enrollment_id=enrollment.id,
        course_id=course.id,
        lesson_id=lesson.id,
        quiz_attempts=1,
        quiz_score=score,
        quiz_passed_at=func.now() if passed else None,
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["enrollment_id", "lesson_id"],
            set_={
                "quiz_attempts": LessonProgress.quiz_attempts + 1,
                "quiz_score": func.greatest(func.coalesce(LessonProgress.quiz_score, 0), stmt.excluded.quiz_score),
                "quiz_passed_at": func.coalesce(LessonProgress.quiz_passed_at, stmt.excluded.quiz_passed_at),
            },
        )
    )
    progress = await after_progress(db, enrollment)
    return QuizResult(
        score=score, total=len(questions), pass_score=need, passed=passed, results=results, progress=progress
    )


async def practice_lesson(db: AsyncSession, principal: Principal, course_id: int, lesson_id: int):
    course = await get_course(db, principal, course_id)
    enrollment = await my_enrollment(db, principal, course)
    lesson = await get_lesson(db, course, lesson_id)
    if lesson.content_type != LessonType.standard or lesson.lesson_kind != LessonKind.practice:
        raise not_found("bài thực hành")
    return course, enrollment, lesson


@router.get(
    "/courses/{course_id}/lessons/{lesson_id}/submissions",
    response_model=list[SubmissionOut],
    summary="Bài tôi đã nộp cho bài thực hành (mới nhất trước)",
)
async def my_submissions(
    course_id: int,
    lesson_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    _, enrollment, lesson = await practice_lesson(db, principal, course_id, lesson_id)
    rows = await db.scalars(
        select(LessonSubmission)
        .where(LessonSubmission.enrollment_id == enrollment.id, LessonSubmission.lesson_id == lesson.id)
        .order_by(LessonSubmission.created_at.desc(), LessonSubmission.id.desc())
    )
    return [submission_out(s) for s in rows]


@router.post(
    "/courses/{course_id}/lessons/{lesson_id}/submissions",
    response_model=SubmissionResult,
    status_code=status.HTTP_201_CREATED,
    summary="Nộp bài thực hành: link và / hoặc file (multipart); nộp xong bài được tính hoàn thành",
)
async def submit_assignment(
    course_id: int,
    lesson_id: int,
    link: str | None = Form(None, max_length=1000),
    note: str | None = Form(None, max_length=20000),
    files: list[UploadFile] | None = File(None),
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    course, enrollment, lesson = await practice_lesson(db, principal, course_id, lesson_id)
    assignment = lesson.assignment or {}
    link = (link or "").strip() or None
    note = (note or "").strip() or None
    files = [f for f in (files or []) if f.filename]

    if link and not LINK_PATTERN.match(link):
        raise unprocessable("Link chưa đúng định dạng (cần bắt đầu bằng https://)")
    if len(files) > settings.submission_max_files:
        raise unprocessable(f"Tối đa {settings.submission_max_files} file mỗi lần nộp")
    max_bytes = settings.submission_max_mb * 1024 * 1024
    for f in files:
        if not f.size:
            raise unprocessable(f"File rỗng: {f.filename}")
        if f.size > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"File {f.filename} lớn hơn {settings.submission_max_mb} MB, hãy gửi qua link",
            )
    text_ok = assignment.get("allow_text") and note is not None and len(note) >= MIN_TEXT_SUBMISSION
    if not (link or files or text_ok):
        extra = f" (hoặc điền nội dung bài ít nhất {MIN_TEXT_SUBMISSION} ký tự)" if assignment.get("allow_text") else ""
        raise unprocessable(f"Cần gửi link hoặc ít nhất một file kết quả{extra}")

    stored: list[dict] = []
    try:
        for f in files:
            name = (f.filename or "file").replace("\\", "/").rsplit("/", 1)[-1].strip()[:200] or "file"
            key = file_storage.object_key(course.company_id, name)
            await file_storage.upload(key, f.file, f.size or 0, f.content_type or "application/octet-stream")
            stored.append({"file_name": name, "storage_key": key, "size_bytes": f.size})
        submission = LessonSubmission(
            company_id=course.company_id,
            enrollment_id=enrollment.id,
            course_id=course.id,
            lesson_id=lesson.id,
            link=link,
            note=note,
            files=stored,
        )
        db.add(submission)
        await db.flush()
        await mark_completed(db, enrollment, course, lesson)
        progress = await after_progress(db, enrollment)
    except Exception:
        for item in stored:  # không để file mồ côi trên R2
            await file_storage.delete(item["storage_key"])
        raise
    await db.refresh(submission)
    return SubmissionResult(submission=submission_out(submission), progress=progress)

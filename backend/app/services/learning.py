"""Quy tắc truy cập nội dung và tính tiến độ học."""

from datetime import date

from sqlalchemy import exists, or_, select, text, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.models import Course, CourseDocument, Document, Enrollment, Lesson
from app.models.enums import CourseStatus, DocumentVisibility, EnrollmentStatus, EnrollMode
from app.schemas.course import DocumentDetail, DocumentOut
from app.schemas.enrollment import EnrollmentOut
from app.services import file_storage
from app.services.common import not_found


async def get_course(db: AsyncSession, principal: Principal, course_id: int) -> Course:
    """Khoá học chưa xoá của công ty hiện tại (không kiểm tra quyền học viên)."""
    course = await db.get(Course, course_id)
    if course is None or course.deleted_at is not None or course.company_id != principal.company.id:
        raise not_found("khoá học")
    return course


async def get_enrollment(db: AsyncSession, course_id: int, user_id: int) -> Enrollment | None:
    return await db.scalar(select(Enrollment).where(Enrollment.course_id == course_id, Enrollment.user_id == user_id))


async def can_view_course(db: AsyncSession, principal: Principal, course: Course) -> bool:
    """Người soạn nội dung xem mọi khoá học; học viên xem khoá đã phát hành mở đăng ký, hoặc khoá mình được ghi danh
    (khoá đã lưu trữ vẫn xem lại được nếu đã ghi danh)."""
    if principal.can("content.manage"):
        return True
    if course.status == CourseStatus.draft:
        return False
    if course.status == CourseStatus.published and course.enroll_mode == EnrollMode.open:
        return True
    return await get_enrollment(db, course.id, principal.user.id) is not None


async def get_visible_course(db: AsyncSession, principal: Principal, course_id: int) -> Course:
    course = await get_course(db, principal, course_id)
    if not await can_view_course(db, principal, course):
        raise not_found("khoá học")  # không lộ khoá học nhân viên không được xem
    return course


def learner_course_ids(user_id: int):
    """Khoá học (chưa xoá, không phải nháp) mà nhân viên đã ghi danh."""
    return (
        select(Enrollment.course_id)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.user_id == user_id, Course.deleted_at.is_(None), Course.status != CourseStatus.draft)
    )


def visible_document_filter(principal: Principal):
    """Điều kiện WHERE: tài liệu học viên được xem = công khai trong công ty, hoặc dùng trong khoá học đã ghi danh."""
    course_ids = learner_course_ids(principal.user.id)
    used_in_my_courses = Document.id.in_(
        union(
            select(CourseDocument.document_id).where(CourseDocument.course_id.in_(course_ids)),
            select(Lesson.document_id).where(Lesson.course_id.in_(course_ids), Lesson.document_id.is_not(None)),
        )
    )
    return or_(Document.visibility == DocumentVisibility.company, used_in_my_courses)


async def get_document(db: AsyncSession, principal: Principal, document_id: int, *, manage: bool = False) -> Document:
    doc = await db.get(Document, document_id)
    if doc is None or doc.deleted_at is not None or doc.company_id != principal.company.id:
        raise not_found("tài liệu")
    if manage or principal.can("content.manage"):
        return doc
    visible = await db.scalar(select(exists().where(Document.id == doc.id, visible_document_filter(principal))))
    if not visible:
        raise not_found("tài liệu")
    return doc


def document_detail(doc: Document) -> DocumentDetail:
    kind = file_storage.preview_kind(doc.file_name)
    return DocumentDetail(
        **DocumentOut.model_validate(doc).model_dump(),
        download_url=file_storage.download_url(doc.storage_key, doc.file_name),
        preview_kind=kind,
        preview_url=file_storage.preview_url(doc.storage_key, doc.file_name, kind) if kind else None,
    )


def enrollment_out[T: EnrollmentOut](enrollment: Enrollment, schema: type[T] = EnrollmentOut, **extra) -> T:
    """EnrollmentOut (hoặc lớp con, truyền thêm trường qua extra) kèm cờ quá hạn."""
    base = EnrollmentOut.model_validate(enrollment).model_dump(exclude={"is_overdue"})
    return schema(**base, is_overdue=is_overdue(enrollment), **extra)


def is_overdue(enrollment: Enrollment) -> bool:
    return (
        enrollment.due_date is not None
        and enrollment.status != EnrollmentStatus.completed
        and enrollment.due_date < date.today()
    )


# % bài bắt buộc đã xong (khoá không có bài bắt buộc thì tính mọi bài). Enrollment đã completed giữ nguyên.
_REFRESH_SQL = """
WITH stats AS (
    SELECT e.id,
           count(l.id) FILTER (WHERE l.is_required)                               AS req_total,
           count(p.completed_at) FILTER (WHERE l.is_required)                     AS req_done,
           count(l.id)                                                            AS all_total,
           count(p.completed_at)                                                  AS all_done,
           count(p.lesson_id)                                                     AS touched
      FROM lms_enrollments e
      LEFT JOIN lms_lessons l ON l.course_id = e.course_id
      LEFT JOIN lms_lesson_progress p ON p.enrollment_id = e.id AND p.lesson_id = l.id
     WHERE e.status <> 'completed' AND {where}
     GROUP BY e.id
), pct AS (
    SELECT id, touched,
           CASE WHEN req_total > 0 THEN round(100.0 * req_done / req_total, 2)
                WHEN all_total > 0 THEN round(100.0 * all_done / all_total, 2)
                ELSE 0 END AS percent
      FROM stats
)
UPDATE lms_enrollments e
   SET progress_percent = pct.percent,
       status = CASE WHEN pct.percent >= 100 THEN 'completed'
                     WHEN pct.touched > 0 THEN 'in_progress'
                     ELSE e.status END,
       started_at = CASE WHEN pct.touched > 0 THEN coalesce(e.started_at, now()) ELSE e.started_at END,
       completed_at = CASE WHEN pct.percent >= 100 THEN now() END
  FROM pct
 WHERE e.id = pct.id
"""


async def refresh_progress(db: AsyncSession, *, enrollment_id: int | None = None, course_id: int | None = None) -> None:
    """Tính lại % hoàn thành sau khi học viên học bài, hoặc khi khoá học thêm / xoá / đổi bài."""
    if enrollment_id is not None:
        await db.execute(text(_REFRESH_SQL.format(where="e.id = :id")), {"id": enrollment_id})
    elif course_id is not None:
        await db.execute(text(_REFRESH_SQL.format(where="e.course_id = :id")), {"id": course_id})

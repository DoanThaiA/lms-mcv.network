from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, str_enum
from app.models.enums import (
    CourseStatus,
    DocumentVisibility,
    EnrollmentSource,
    EnrollmentStatus,
    EnrollMode,
    LessonKind,
    LessonType,
    ReviewStatus,
)

# FK kép (company_id, ...) và ON DELETE nằm trong migrations/sql/0001_lms_schema.sql; model chỉ khai báo FK đơn
# đủ để SQLAlchemy biết thứ tự ghi.


class Category(TimestampMixin, Base):
    __tablename__ = "lms_categories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Document(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "lms_documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lms_categories.id"))
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    content_type: Mapped[str | None] = mapped_column(String(150))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    visibility: Mapped[DocumentVisibility] = mapped_column(
        str_enum(DocumentVisibility, 10), default=DocumentVisibility.company
    )
    uploaded_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))


class Course(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "lms_courses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lms_categories.id"))
    code: Mapped[str] = mapped_column(CITEXT)
    title: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[CourseStatus] = mapped_column(str_enum(CourseStatus, 10), default=CourseStatus.draft)
    enroll_mode: Mapped[EnrollMode] = mapped_column(str_enum(EnrollMode, 10), default=EnrollMode.assigned)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Lesson(TimestampMixin, Base):
    __tablename__ = "lms_lessons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_courses.id"))
    title: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[LessonType] = mapped_column(str_enum(LessonType, 10))
    lesson_kind: Mapped[LessonKind | None] = mapped_column(str_enum(LessonKind, 10))
    body: Mapped[str | None] = mapped_column(Text)
    external_url: Mapped[str | None] = mapped_column(String(1000))
    document_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("lms_documents.id"))
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    # Bài học chuẩn (content_type = standard); body là nội dung HTML, video = document_id / external_url
    goals: Mapped[list[str]] = mapped_column(JSONB, default=list)
    video_minutes: Mapped[int | None] = mapped_column(Integer)
    quiz: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    assignment: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class LessonDocument(Base):
    """Tài liệu thực hành của bài học."""

    __tablename__ = "lms_lesson_documents"

    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    lesson_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_lessons.id"), primary_key=True)
    document_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_documents.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class CourseDocument(Base):
    __tablename__ = "lms_course_documents"

    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_courses.id"), primary_key=True)
    document_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_documents.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Enrollment(TimestampMixin, Base):
    __tablename__ = "lms_enrollments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_courses.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    source: Mapped[EnrollmentSource] = mapped_column(str_enum(EnrollmentSource, 10), default=EnrollmentSource.assigned)
    assigned_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[EnrollmentStatus] = mapped_column(
        str_enum(EnrollmentStatus, 15), default=EnrollmentStatus.not_started
    )
    progress_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal(0))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LessonProgress(Base):
    __tablename__ = "lms_lesson_progress"

    enrollment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_enrollments.id"), primary_key=True)
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_courses.id"))
    lesson_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_lessons.id"), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_position_seconds: Mapped[int] = mapped_column(Integer, default=0)
    video_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    quiz_attempts: Mapped[int] = mapped_column(Integer, default=0)
    quiz_score: Mapped[int | None] = mapped_column(Integer)
    quiz_passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), server_onupdate=FetchedValue()
    )


class LessonSubmission(TimestampMixin, Base):
    """Bài nộp của bài thực hành."""

    __tablename__ = "lms_lesson_submissions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("companies.id"))
    enrollment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_enrollments.id"))
    course_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_courses.id"))
    lesson_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lms_lessons.id"))
    link: Mapped[str | None] = mapped_column(String(1000))
    note: Mapped[str | None] = mapped_column(Text)
    files: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    review_status: Mapped[ReviewStatus] = mapped_column(str_enum(ReviewStatus, 10), default=ReviewStatus.pending)
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

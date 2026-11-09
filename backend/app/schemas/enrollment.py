from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import EnrollmentSource, EnrollmentStatus, ReviewStatus
from app.schemas.common import ORMModel
from app.schemas.course import CourseOut
from app.schemas.employee import EmployeeBrief


class EnrollmentOut(ORMModel):
    id: int
    course_id: int
    user_id: int
    source: EnrollmentSource
    assigned_by: int | None
    due_date: date | None
    status: EnrollmentStatus
    progress_percent: Decimal
    started_at: datetime | None
    completed_at: datetime | None
    last_accessed_at: datetime | None
    created_at: datetime
    is_overdue: bool = False


class EnrollmentDetail(EnrollmentOut):
    employee: EmployeeBrief
    course_code: str
    course_title: str


class MyCourse(EnrollmentOut):
    course: CourseOut


class EnrollmentAssign(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=1000)
    due_date: date | None = None


class AssignResult(BaseModel):
    created: list[EnrollmentOut]
    skipped_user_ids: list[int] = Field(description="Đã ghi danh khoá học từ trước")


class EnrollmentUpdate(BaseModel):
    due_date: date | None = None


class LessonProgressIn(BaseModel):
    completed: bool = False
    position_seconds: int | None = Field(
        default=None, ge=0, description="Vị trí đang xem (video file); số giây đã mở video nhúng (bài học chuẩn)"
    )
    video_completed: bool = Field(default=False, description="Đã xem hết video (bài học chuẩn)")


class LessonProgressOut(ORMModel):
    lesson_id: int
    started_at: datetime
    completed_at: datetime | None
    last_position_seconds: int
    video_completed_at: datetime | None = None
    quiz_attempts: int = 0
    quiz_score: int | None = None
    quiz_passed_at: datetime | None = None


class CourseProgress(BaseModel):
    enrollment: EnrollmentOut
    lessons: list[LessonProgressOut]


class CourseReport(BaseModel):
    course_id: int
    code: str
    title: str
    status: str
    enrolled: int
    not_started: int
    in_progress: int
    completed: int
    overdue: int
    completion_rate: Decimal


# --- Bài học chuẩn: câu hỏi kiểm tra, nộp bài ---
class QuizAttemptIn(BaseModel):
    answers: list[int] = Field(description="Phương án chọn cho từng câu, theo thứ tự câu hỏi (từ 0)")


class QuizQuestionResult(BaseModel):
    correct: bool
    explanation: str | None


class QuizResult(BaseModel):
    score: int
    total: int
    pass_score: int = Field(description="Số câu đúng cần đạt")
    passed: bool = Field(description="Lần làm này đạt")
    results: list[QuizQuestionResult]
    progress: CourseProgress


class SubmissionFile(BaseModel):
    file_name: str
    size_bytes: int
    download_url: str


class SubmissionOut(BaseModel):
    id: int
    enrollment_id: int
    lesson_id: int
    link: str | None
    note: str | None
    files: list[SubmissionFile]
    review_status: ReviewStatus
    review_note: str | None
    reviewed_by: int | None
    reviewed_at: datetime | None
    created_at: datetime


class SubmissionResult(BaseModel):
    submission: SubmissionOut
    progress: CourseProgress


class SubmissionReview(BaseModel):
    review_status: ReviewStatus
    review_note: str | None = Field(default=None, max_length=4000)

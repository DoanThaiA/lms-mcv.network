from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import EnrollmentSource, EnrollmentStatus
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
    position_seconds: int | None = Field(default=None, ge=0, description="Vị trí đang xem (video)")


class LessonProgressOut(ORMModel):
    lesson_id: int
    started_at: datetime
    completed_at: datetime | None
    last_position_seconds: int


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

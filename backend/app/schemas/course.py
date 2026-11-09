from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, field_validator, model_validator

from app.models.enums import CourseStatus, DocumentVisibility, EnrollMode, LessonKind, LessonType
from app.schemas.common import ORMModel

COURSE_CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$"


# --- Danh mục ---
class CategoryOut(ORMModel):
    id: int
    name: str
    description: str | None
    sort_order: int


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    description: str | None = None
    sort_order: int | None = None


# --- Tài liệu ---
class DocumentOut(ORMModel):
    id: int
    category_id: int | None
    title: str
    description: str | None
    file_name: str
    content_type: str | None
    size_bytes: int
    visibility: DocumentVisibility
    uploaded_by: int | None
    created_at: datetime
    updated_at: datetime


class DocumentDetail(DocumentOut):
    download_url: str
    preview_kind: str | None  # pdf | image | video | audio | text | office | None (chỉ tải về)
    preview_url: str | None


class UploadUrlRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    content_type: str | None = Field(default=None, max_length=150)


class UploadUrlOut(BaseModel):
    upload_url: str = Field(description="PUT file lên URL này (hết hạn sau 1 giờ), kèm header Content-Type")
    storage_key: str
    expires_in: int


class DocumentComplete(BaseModel):
    """Xác nhận đã PUT xong file lên R2 -> tạo tài liệu."""

    storage_key: str = Field(max_length=500)
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str | None = Field(default=None, max_length=150)
    title: str | None = Field(default=None, max_length=255)
    description: str | None = None
    category_id: int | None = None
    visibility: DocumentVisibility = DocumentVisibility.company


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category_id: int | None = None
    visibility: DocumentVisibility | None = None


# --- Bài học ---
Line = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


def _clean_lines(items: list[str]) -> list[str]:
    return [x for x in (i.strip() for i in items) if x]


class QuizQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    options: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]] = Field(
        min_length=2, max_length=10
    )
    answer: int = Field(ge=0, description="Vị trí đáp án đúng trong options (từ 0)")
    explanation: str | None = Field(default=None, max_length=4000, description="Giải thích, hiện sau khi chấm")

    @model_validator(mode="after")
    def _check_answer(self) -> Self:
        if self.answer >= len(self.options):
            raise ValueError("answer phải là vị trí một phương án trong options")
        return self


class Quiz(BaseModel):
    """Câu hỏi kiểm tra trắc nghiệm, chấm trên máy chủ."""

    pass_score: int | None = Field(default=None, ge=1, description="Số câu đúng tối thiểu; bỏ trống = đúng tất cả")
    must_correct: list[int] = Field(
        default_factory=list, max_length=100, description="Vị trí (từ 0) các câu bắt buộc đúng, vd câu bảo mật"
    )
    questions: list[QuizQuestion] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _check_pass(self) -> Self:
        if self.pass_score is not None and self.pass_score > len(self.questions):
            raise ValueError("pass_score lớn hơn số câu hỏi")
        if any(i < 0 or i >= len(self.questions) for i in self.must_correct):
            raise ValueError("must_correct có vị trí câu hỏi không tồn tại")
        self.must_correct = sorted(set(self.must_correct))
        return self


class QuizQuestionOut(BaseModel):
    question: str
    options: list[str]
    answer: int | None = Field(description="Chỉ người soạn nội dung thấy; học viên nhận null")
    explanation: str | None


class QuizOut(BaseModel):
    pass_score: int | None
    must_correct: list[int] = []
    questions: list[QuizQuestionOut]


class Assignment(BaseModel):
    """Yêu cầu nộp bài của bài thực hành."""

    requirement: str = Field(min_length=1, max_length=4000, description="Bài nộp cần có")
    criteria: list[Line] = Field(default_factory=list, max_length=30, description="Tiêu chí đạt")
    allow_text: bool = Field(default=False, description="Cho nộp bằng nội dung gõ vào ô ghi chú (không cần link/file)")

    @field_validator("criteria")
    @classmethod
    def _clean_criteria(cls, v: list[str]) -> list[str]:
        return _clean_lines(v)


class LessonFields(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content_type: LessonType
    body: str | None = None
    external_url: HttpUrl | None = None
    document_id: int | None = None
    duration_minutes: int | None = Field(default=None, ge=0)
    is_required: bool = True
    # Bài học chuẩn
    lesson_kind: LessonKind | None = None
    goals: list[Line] = Field(default_factory=list, max_length=30, description="Mục tiêu bài học")
    video_minutes: int | None = Field(default=None, ge=0, le=10000, description="Thời lượng video (phút)")
    quiz: Quiz | None = None
    assignment: Assignment | None = None
    practice_document_ids: list[int] = Field(
        default_factory=list, max_length=50, description="Tài liệu thực hành (id tài liệu trong thư viện)"
    )

    @field_validator("goals")
    @classmethod
    def _clean_goals(cls, v: list[str]) -> list[str]:
        return _clean_lines(v)

    @field_validator("practice_document_ids")
    @classmethod
    def _unique_ids(cls, v: list[int]) -> list[int]:
        return list(dict.fromkeys(v))


class LessonCreate(LessonFields):
    sort_order: int | None = None  # bỏ trống = cuối danh sách

    @model_validator(mode="after")
    def _check_content(self) -> Self:
        if self.content_type != LessonType.standard:  # trường của bài chuẩn bỏ qua với loại bài khác
            self.lesson_kind = self.video_minutes = self.quiz = self.assignment = None
            self.goals, self.practice_document_ids = [], []
        # Chỉ giữ câu hỏi / yêu cầu nộp bài đúng với dạng bài
        if self.lesson_kind != LessonKind.quiz:
            self.quiz = None
        if self.lesson_kind != LessonKind.practice:
            self.assignment = None
        check_lesson_content(self.__dict__)
        return self


class LessonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_type: LessonType | None = None
    body: str | None = None
    external_url: HttpUrl | None = None
    document_id: int | None = None
    duration_minutes: int | None = Field(default=None, ge=0)
    is_required: bool | None = None
    lesson_kind: LessonKind | None = None
    goals: list[Line] | None = Field(default=None, max_length=30)
    video_minutes: int | None = Field(default=None, ge=0, le=10000)
    quiz: Quiz | None = None
    assignment: Assignment | None = None
    practice_document_ids: list[int] | None = Field(default=None, max_length=50)

    @field_validator("goals")
    @classmethod
    def _clean_goals(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_lines(v)

    @field_validator("practice_document_ids")
    @classmethod
    def _unique_ids(cls, v: list[int] | None) -> list[int] | None:
        return None if v is None else list(dict.fromkeys(v))


STANDARD_ONLY = ("lesson_kind", "video_minutes", "quiz", "assignment")


def check_lesson_content(v: Mapping[str, Any]) -> None:
    """Kiểm tra nội dung đủ theo loại bài. v: các trường của bài (sau khi gộp thay đổi khi sửa)."""
    kind = v["content_type"]
    if kind == LessonType.text and not v.get("body"):
        raise ValueError("Bài học dạng text cần nội dung (body)")
    if kind == LessonType.document and v.get("document_id") is None:
        raise ValueError("Bài học dạng document cần document_id")
    if kind == LessonType.link and v.get("external_url") is None:
        raise ValueError("Bài học dạng link cần external_url")
    if kind == LessonType.video and v.get("external_url") is None and v.get("document_id") is None:
        raise ValueError("Bài học dạng video cần document_id (file video) hoặc external_url")
    if kind == LessonType.standard:
        lesson_kind = v.get("lesson_kind")
        if lesson_kind is None:
            raise ValueError("Bài học chuẩn cần lesson_kind (theory / quiz / practice)")
        if lesson_kind == LessonKind.quiz and not v.get("quiz"):
            raise ValueError("Bài lý thuyết + kiểm tra cần câu hỏi kiểm tra (quiz)")
        if lesson_kind == LessonKind.practice and not v.get("assignment"):
            raise ValueError("Bài thực hành cần yêu cầu nộp bài (assignment)")
        if not (v.get("body") or v.get("goals") or v.get("external_url") or v.get("document_id")):
            raise ValueError("Bài học chuẩn cần ít nhất mục tiêu, video hoặc nội dung")


class LessonOut(ORMModel):
    id: int
    course_id: int
    title: str
    content_type: LessonType
    lesson_kind: LessonKind | None
    duration_minutes: int | None
    sort_order: int
    is_required: bool


class LessonDetail(LessonOut):
    body: str | None
    external_url: str | None
    document_id: int | None
    document: DocumentDetail | None = None
    goals: list[str] = []
    video_minutes: int | None = None
    quiz: QuizOut | None = None
    assignment: Assignment | None = None
    practice_documents: list[DocumentDetail] = []


class LessonBulkCreate(BaseModel):
    """Thêm nhiều bài một lần (nhập từ file khoá học mẫu): tất cả hoặc không bài nào."""

    lessons: list[LessonCreate] = Field(min_length=1, max_length=200)


class LessonOrder(BaseModel):
    lesson_ids: list[int] = Field(min_length=1, description="Toàn bộ id bài học theo thứ tự mới")


# --- Khoá học ---
class CourseOut(ORMModel):
    id: int
    category_id: int | None
    code: str
    title: str
    summary: str | None
    thumbnail_url: str | None
    status: CourseStatus
    enroll_mode: EnrollMode
    estimated_minutes: int | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CourseDetail(CourseOut):
    description: str | None
    created_by: int | None
    lessons: list[LessonOut]
    documents: list[DocumentOut]


class CourseCreate(BaseModel):
    code: str = Field(pattern=COURSE_CODE_PATTERN)
    title: str = Field(min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=500)
    description: str | None = None
    category_id: int | None = None
    thumbnail_url: str | None = Field(default=None, max_length=500)
    enroll_mode: EnrollMode = EnrollMode.assigned
    estimated_minutes: int | None = Field(default=None, ge=0)


class CourseUpdate(BaseModel):
    code: str | None = Field(default=None, pattern=COURSE_CODE_PATTERN)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=500)
    description: str | None = None
    category_id: int | None = None
    thumbnail_url: str | None = Field(default=None, max_length=500)
    enroll_mode: EnrollMode | None = None
    estimated_minutes: int | None = Field(default=None, ge=0)


class CourseStatusChange(BaseModel):
    status: CourseStatus


class CourseDocumentsSet(BaseModel):
    document_ids: list[int] = Field(description="Tài liệu tham khảo theo thứ tự hiển thị")

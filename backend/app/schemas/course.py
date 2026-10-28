from datetime import datetime
from typing import Self

from pydantic import BaseModel, Field, HttpUrl, model_validator

from app.models.enums import CourseStatus, DocumentVisibility, EnrollMode, LessonType
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
class LessonFields(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content_type: LessonType
    body: str | None = None
    external_url: HttpUrl | None = None
    document_id: int | None = None
    duration_minutes: int | None = Field(default=None, ge=0)
    is_required: bool = True


class LessonCreate(LessonFields):
    sort_order: int | None = None  # bỏ trống = cuối danh sách

    @model_validator(mode="after")
    def _check_content(self) -> Self:
        check_lesson_content(self.content_type, self.body, self.external_url, self.document_id)
        return self


class LessonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_type: LessonType | None = None
    body: str | None = None
    external_url: HttpUrl | None = None
    document_id: int | None = None
    duration_minutes: int | None = Field(default=None, ge=0)
    is_required: bool | None = None


def check_lesson_content(kind: LessonType, body: str | None, url: object, document_id: int | None) -> None:
    if kind == LessonType.text and not body:
        raise ValueError("Bài học dạng text cần nội dung (body)")
    if kind == LessonType.document and document_id is None:
        raise ValueError("Bài học dạng document cần document_id")
    if kind == LessonType.link and url is None:
        raise ValueError("Bài học dạng link cần external_url")
    if kind == LessonType.video and url is None and document_id is None:
        raise ValueError("Bài học dạng video cần document_id (file video) hoặc external_url")


class LessonOut(ORMModel):
    id: int
    course_id: int
    title: str
    content_type: LessonType
    duration_minutes: int | None
    sort_order: int
    is_required: bool


class LessonDetail(LessonOut):
    body: str | None
    external_url: str | None
    document_id: int | None
    document: DocumentDetail | None = None


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

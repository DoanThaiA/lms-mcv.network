"""Thư viện tài liệu: file lưu trên Cloudflare R2, tải / xem qua URL ký tạm."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal, require
from app.api.v1.endpoints.categories import ensure_category
from app.core.config import settings
from app.db.session import get_db
from app.models import Course, Document, Lesson
from app.models.enums import DocumentVisibility
from app.schemas.common import Page
from app.schemas.course import (
    DocumentComplete,
    DocumentDetail,
    DocumentOut,
    DocumentUpdate,
    UploadUrlOut,
    UploadUrlRequest,
)
from app.services import file_storage
from app.services.common import apply_update, paginate
from app.services.learning import document_detail, get_document, visible_document_filter

router = APIRouter()


@router.get("", response_model=Page[DocumentOut], summary="Tài liệu nhân viên được xem (người soạn nội dung: tất cả)")
async def list_documents(
    q: str | None = Query(None, description="Tìm theo tiêu đề, tên file"),
    category_id: int | None = None,
    visibility: DocumentVisibility | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Document)
        .where(Document.company_id == principal.company.id, Document.deleted_at.is_(None))
        .order_by(Document.created_at.desc(), Document.id.desc())
    )
    if not principal.can("content.manage"):
        stmt = stmt.where(visible_document_filter(principal))
    if q:
        stmt = stmt.where(or_(Document.title.ilike(f"%{q}%"), Document.file_name.ilike(f"%{q}%")))
    if category_id is not None:
        stmt = stmt.where(Document.category_id == category_id)
    if visibility:
        stmt = stmt.where(Document.visibility == visibility)
    return await paginate(db, stmt, page, size)


def clean_file_name(name: str) -> str:
    return (name or "file").replace("\\", "/").rsplit("/", 1)[-1].strip()[:200] or "file"


def check_size(size: int) -> None:
    if size <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="File rỗng")
    if size > settings.file_max_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=f"File vượt quá {settings.file_max_mb} MB"
        )


@router.post(
    "/upload-url",
    response_model=UploadUrlOut,
    summary="Bước 1: xin URL để trình duyệt PUT file thẳng lên Cloudflare R2 (dùng cho video / file lớn)",
)
async def create_upload_url(body: UploadUrlRequest, principal: Principal = Depends(require("content.manage"))):
    check_size(body.size_bytes)
    key = file_storage.object_key(principal.company.id, clean_file_name(body.file_name))
    return UploadUrlOut(
        upload_url=file_storage.upload_url(key), storage_key=key, expires_in=settings.upload_url_expire_seconds
    )


@router.post(
    "/complete",
    response_model=DocumentDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Bước 2: xác nhận đã tải file lên R2 xong -> tạo tài liệu",
)
async def complete_upload(
    body: DocumentComplete,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    # Key phải do upload-url cấp cho công ty này (không nhận key của công ty khác / file có sẵn)
    if not body.storage_key.startswith(file_storage.company_prefix(principal.company.id)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="storage_key không hợp lệ")
    if await db.scalar(select(exists().where(Document.storage_key == body.storage_key))):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="File này đã được tạo tài liệu")
    await ensure_category(db, principal, body.category_id)
    info = await file_storage.stat(body.storage_key)
    if info is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chưa thấy file trên Cloudflare R2, tải lại")
    size, stored_type = info
    try:
        check_size(size)
    except HTTPException:
        await file_storage.delete(body.storage_key)
        raise
    file_name = clean_file_name(body.file_name)
    doc = Document(
        company_id=principal.company.id,
        category_id=body.category_id,
        title=(body.title or "").strip() or file_name,
        description=body.description,
        file_name=file_name,
        storage_key=body.storage_key,
        content_type=body.content_type or stored_type or "application/octet-stream",
        size_bytes=size,
        visibility=body.visibility,
        uploaded_by=principal.user.id,
    )
    db.add(doc)
    await db.commit()
    return document_detail(doc)


@router.post(
    "",
    response_model=DocumentDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Tải tài liệu lên qua API (multipart; file nhỏ / khi bucket chưa bật CORS)",
)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(None, max_length=255, description="Bỏ trống = tên file"),
    description: str | None = Form(None),
    category_id: int | None = Form(None),
    visibility: DocumentVisibility = Form(DocumentVisibility.company),
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    file_name = clean_file_name(file.filename or "file")
    size = file.size or 0
    check_size(size)
    await ensure_category(db, principal, category_id)

    key = file_storage.object_key(principal.company.id, file_name)
    content_type = file.content_type or "application/octet-stream"
    await file_storage.upload(key, file.file, size, content_type)
    doc = Document(
        company_id=principal.company.id,
        category_id=category_id,
        title=(title or "").strip() or file_name,
        description=description,
        file_name=file_name,
        storage_key=key,
        content_type=content_type,
        size_bytes=size,
        visibility=visibility,
        uploaded_by=principal.user.id,
    )
    db.add(doc)
    try:
        await db.commit()
    except Exception:
        await file_storage.delete(key)  # không để file mồ côi trên R2
        raise
    return document_detail(doc)


@router.get(
    "/{document_id}", response_model=DocumentDetail, summary="Chi tiết + link tải / xem trước (hết hạn sau 1 giờ)"
)
async def get_document_detail(
    document_id: int,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
):
    return document_detail(await get_document(db, principal, document_id))


@router.patch("/{document_id}", response_model=DocumentDetail)
async def update_document(
    document_id: int,
    body: DocumentUpdate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    doc = await get_document(db, principal, document_id, manage=True)
    if "category_id" in body.model_fields_set:
        await ensure_category(db, principal, body.category_id)
    apply_update(doc, body)
    await db.commit()
    return document_detail(doc)


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Xoá tài liệu (xoá mềm; không xoá được khi bài học còn dùng)",
)
async def delete_document(
    document_id: int,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    doc = await get_document(db, principal, document_id, manage=True)
    in_use = await db.scalar(
        select(
            exists()
            .where(Lesson.document_id == doc.id)
            .where(Course.id == Lesson.course_id, Course.deleted_at.is_(None))
        )
    )
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tài liệu đang được dùng trong bài học")
    doc.deleted_at = func.now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

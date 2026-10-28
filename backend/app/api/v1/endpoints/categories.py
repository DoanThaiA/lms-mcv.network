from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_current_principal, require
from app.db.session import get_db
from app.models import Category
from app.schemas.course import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.common import apply_update, not_found, unprocessable

router = APIRouter()


async def ensure_category(db: AsyncSession, principal: Principal, category_id: int | None) -> None:
    """Danh mục gán cho khoá học / tài liệu phải thuộc công ty hiện tại."""
    if category_id is None:
        return
    category = await db.get(Category, category_id)
    if category is None or category.company_id != principal.company.id:
        raise unprocessable(f"Danh mục id={category_id} không tồn tại")


async def get_category(db: AsyncSession, principal: Principal, category_id: int) -> Category:
    category = await db.get(Category, category_id)
    if category is None or category.company_id != principal.company.id:
        raise not_found("danh mục")
    return category


@router.get("", response_model=list[CategoryOut])
async def list_categories(principal: Principal = Depends(get_current_principal), db: AsyncSession = Depends(get_db)):
    stmt = (
        select(Category).where(Category.company_id == principal.company.id).order_by(Category.sort_order, Category.name)
    )
    return (await db.scalars(stmt)).all()


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CategoryCreate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    category = Category(**body.model_dump(), company_id=principal.company.id)
    db.add(category)
    await db.commit()
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    category = await get_category(db, principal, category_id)
    apply_update(category, body)
    await db.commit()
    return category


@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Xoá danh mục (khoá học / tài liệu trong danh mục chuyển về 'không danh mục')",
)
async def delete_category(
    category_id: int,
    principal: Principal = Depends(require("content.manage")),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(await get_category(db, principal, category_id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

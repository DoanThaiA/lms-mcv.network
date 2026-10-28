"""Doanh nghiệp — chỉ quản trị hệ thống (users.is_system_admin)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, require
from app.db.session import get_db
from app.models import Company, User
from app.schemas.common import Page
from app.schemas.company import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.common import apply_update, not_found, paginate

router = APIRouter()


async def get_company(db: AsyncSession, company_id: int) -> Company:
    company = await db.get(Company, company_id)
    if company is None or company.deleted_at is not None:
        raise not_found("doanh nghiệp")
    return company


@router.get("", response_model=Page[CompanyOut])
async def list_companies(
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    _: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Company).where(Company.deleted_at.is_(None)).order_by(Company.code)
    if q:
        stmt = stmt.where(or_(Company.code.ilike(f"%{q}%"), Company.name.ilike(f"%{q}%")))
    return await paginate(db, stmt, page, size)


@router.post("", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
async def create_company(
    body: CompanyCreate,
    principal: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    company = Company(**body.model_dump(), created_by=principal.user.id)
    db.add(company)
    await db.commit()
    return company


@router.get("/{company_id}", response_model=CompanyOut)
async def get_company_detail(
    company_id: int,
    _: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await get_company(db, company_id)


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: int,
    body: CompanyUpdate,
    principal: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    company = await get_company(db, company_id)
    if company.id == principal.company.id and body.status is not None and body.status != company.status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không tự đổi trạng thái công ty của mình")
    apply_update(company, body)
    await db.commit()
    return company


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_company(
    company_id: int,
    principal: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    company = await get_company(db, company_id)
    if company.id == principal.company.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không xoá được công ty của mình")
    has_employees = await db.scalar(select(exists().where(User.company_id == company.id, User.deleted_at.is_(None))))
    if has_employees:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Công ty còn nhân viên, chuyển / xoá trước")
    company.deleted_at = func.now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

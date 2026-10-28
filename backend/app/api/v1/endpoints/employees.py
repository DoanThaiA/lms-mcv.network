"""Nhân viên của doanh nghiệp = tài khoản trong bảng users (dùng chung Project Manager) có company_id + employee_code.

Quản trị LMS (employee.manage) quản lý nhân viên công ty mình; quản trị hệ thống quản lý mọi công ty.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, get_role, require
from app.api.v1.endpoints.companies import get_company
from app.core.security import hash_password
from app.db.session import get_db
from app.models import Company, Enrollment, LmsUserRole, User
from app.models.enums import LmsRole, UserStatus
from app.schemas.common import Message, Page
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeDetail,
    EmployeeLink,
    EmployeeOut,
    EmployeeUpdate,
    PasswordReset,
    RoleSet,
)
from app.services.common import apply_update, not_found

router = APIRouter()
lookup_router = APIRouter()


async def company_scope(
    company_id: int,
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
) -> Company:
    if company_id != principal.company.id and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ quản lý được nhân viên công ty mình")
    return await get_company(db, company_id)


async def get_employee(db: AsyncSession, company: Company, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None or user.company_id != company.id:
        raise not_found("nhân viên")
    return user


async def set_role(db: AsyncSession, user_id: int, role: LmsRole, granted_by: int) -> None:
    await db.execute(delete(LmsUserRole).where(LmsUserRole.user_id == user_id))
    if role != LmsRole.learner:  # learner là mặc định, không lưu
        db.add(LmsUserRole(user_id=user_id, role=role, granted_by=granted_by))


def guard_role_change(principal: Principal, target: User, role: LmsRole) -> None:
    if target.id == principal.user.id and role != principal.role and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không tự đổi vai trò của mình")
    if target.is_system_admin and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Không sửa được quản trị hệ thống")


async def employee_detail(db: AsyncSession, user: User) -> EmployeeDetail:
    return EmployeeDetail(**EmployeeOut.model_validate(user).model_dump(), role=await get_role(db, user.id))


@router.get("", response_model=Page[EmployeeDetail])
async def list_employees(
    q: str | None = Query(None, description="Tìm theo mã nhân viên, họ tên, email"),
    role: LmsRole | None = None,
    status_: UserStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    company: Company = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
):
    role_col = func.coalesce(LmsUserRole.role, LmsRole.learner.value)
    stmt = (
        select(User, role_col)
        .outerjoin(LmsUserRole, LmsUserRole.user_id == User.id)
        .where(User.company_id == company.id, User.deleted_at.is_(None))
        .order_by(User.employee_code, User.id)
    )
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(User.employee_code.ilike(pattern), User.full_name.ilike(pattern), User.email.ilike(pattern))
        )
    if role:
        stmt = stmt.where(role_col == role.value)
    if status_:
        stmt = stmt.where(User.status == status_)
    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await db.execute(stmt.limit(size).offset((page - 1) * size))).all()
    items = [EmployeeDetail(**EmployeeOut.model_validate(u).model_dump(), role=r) for u, r in rows]
    return {"items": items, "total": total or 0, "page": page, "size": size}


@router.post("", response_model=EmployeeDetail, status_code=status.HTTP_201_CREATED, summary="Tạo tài khoản nhân viên")
async def create_employee(
    body: EmployeeCreate,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
):
    username = body.username or f"{company.code}.{body.employee_code}".lower()
    user = User(
        username=username,
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        phone=body.phone,
        job_title=body.job_title,
        company_id=company.id,
        employee_code=body.employee_code,
    )
    db.add(user)
    await db.flush()
    await set_role(db, user.id, body.role, principal.user.id)
    await db.commit()
    return await employee_detail(db, user)


@router.post(
    "/link",
    response_model=EmployeeDetail,
    summary="Gán tài khoản có sẵn (Project Manager) vào công ty — chỉ quản trị hệ thống",
)
async def link_employee(
    body: EmployeeLink,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, body.user_id)
    if user is None or user.deleted_at is not None:
        raise not_found("tài khoản")
    if user.company_id is not None and user.company_id != company.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tài khoản đang thuộc công ty khác")
    guard_role_change(principal, user, body.role)
    user.company_id = company.id
    user.employee_code = body.employee_code
    await set_role(db, user.id, body.role, principal.user.id)
    await db.commit()
    return await employee_detail(db, user)


@router.get("/{user_id}", response_model=EmployeeDetail)
async def get_employee_detail(
    user_id: int,
    company: Company = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
):
    return await employee_detail(db, await get_employee(db, company, user_id))


@router.patch("/{user_id}", response_model=EmployeeDetail)
async def update_employee(
    user_id: int,
    body: EmployeeUpdate,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
):
    user = await get_employee(db, company, user_id)
    if user.is_system_admin and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Không sửa được quản trị hệ thống")
    if user.id == principal.user.id and body.status not in (None, UserStatus.active):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không tự khoá tài khoản của mình")
    if "employee_code" in body.model_fields_set and body.employee_code is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Mã nhân viên không được để trống"
        )
    apply_update(user, body)
    await db.commit()
    return await employee_detail(db, user)


@router.put("/{user_id}/role", response_model=EmployeeDetail, summary="Đặt vai trò LMS")
async def set_employee_role(
    user_id: int,
    body: RoleSet,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
):
    user = await get_employee(db, company, user_id)
    guard_role_change(principal, user, body.role)
    await set_role(db, user.id, body.role, principal.user.id)
    await db.commit()
    return await employee_detail(db, user)


@router.post("/{user_id}/reset-password", response_model=Message)
async def reset_password(
    user_id: int,
    body: PasswordReset,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
):
    user = await get_employee(db, company, user_id)
    if user.is_system_admin and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Không sửa được quản trị hệ thống")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Message(detail="Đã đặt lại mật khẩu")


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Gỡ nhân viên khỏi công ty (giữ tài khoản Project Manager, xoá ghi danh LMS)",
)
async def remove_employee(
    user_id: int,
    company: Company = Depends(company_scope),
    principal: Principal = Depends(require("employee.manage")),
    db: AsyncSession = Depends(get_db),
):
    user = await get_employee(db, company, user_id)
    if user.id == principal.user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không tự gỡ tài khoản của mình")
    if user.is_system_admin and not principal.user.is_system_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Không sửa được quản trị hệ thống")
    await db.execute(delete(Enrollment).where(Enrollment.user_id == user.id))
    await db.execute(delete(LmsUserRole).where(LmsUserRole.user_id == user.id))
    user.employee_code = None
    user.company_id = None
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@lookup_router.get(
    "/lookup",
    response_model=list[EmployeeOut],
    summary="Tra nhân viên đang hoạt động của công ty mình (chọn người khi giao khoá học)",
)
async def lookup_employees(
    q: str | None = Query(None, description="Mã nhân viên, họ tên, email"),
    limit: int = Query(50, ge=1, le=500),
    principal: Principal = Depends(require("enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(User)
        .where(
            User.company_id == principal.company.id,
            User.employee_code.is_not(None),
            User.deleted_at.is_(None),
            User.status == UserStatus.active,
        )
        .order_by(User.employee_code)
        .limit(limit)
    )
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(User.employee_code.ilike(pattern), User.full_name.ilike(pattern), User.email.ilike(pattern))
        )
    return (await db.scalars(stmt)).all()


@lookup_router.get(
    "/unassigned",
    response_model=list[EmployeeOut],
    summary="Tài khoản chưa thuộc công ty nào (vd: đang dùng Project Manager) — chỉ quản trị hệ thống",
)
async def unassigned_users(
    q: str | None = Query(None, description="Username, họ tên, email"),
    limit: int = Query(50, ge=1, le=200),
    _: Principal = Depends(require("company.manage")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(User).where(User.company_id.is_(None), User.deleted_at.is_(None)).order_by(User.full_name).limit(limit)
    )
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(User.username.ilike(pattern), User.full_name.ilike(pattern), User.email.ilike(pattern)))
    return (await db.scalars(stmt)).all()

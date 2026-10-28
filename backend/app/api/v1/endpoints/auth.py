from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal, client_ip, get_current_principal, set_audit_context
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import ActivityLog, Company, User
from app.schemas.auth import LoginRequest, MeOut, PasswordChange, Token
from app.schemas.common import Message
from app.schemas.company import CompanyBrief
from app.schemas.employee import EmployeeOut

router = APIRouter()

# activity_logs dùng chung với project_manager: action riêng để phân biệt đăng nhập LMS
LOGIN, LOGIN_FAILED = "lms_login", "lms_login_failed"


async def _recent_failures(db: AsyncSession, user_id: int) -> int:
    """Số lần sai mật khẩu LMS liên tiếp (sau lần đăng nhập thành công gần nhất) trong login_lock_minutes phút."""
    last_success = (
        select(func.max(ActivityLog.occurred_at))
        .where(ActivityLog.actor_id == user_id, ActivityLog.action == LOGIN)
        .scalar_subquery()
    )
    since = func.now() - timedelta(minutes=settings.login_lock_minutes)
    return await db.scalar(
        select(func.count()).where(
            ActivityLog.actor_id == user_id,
            ActivityLog.action == LOGIN_FAILED,
            ActivityLog.occurred_at > func.greatest(since, func.coalesce(last_success, since)),
        )
    )


@router.post("/login", response_model=Token, summary="Đăng nhập bằng mã công ty + mã nhân viên + mật khẩu")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)) -> Token:
    company = await db.scalar(
        select(Company).where(Company.code == body.company_code.strip(), Company.deleted_at.is_(None))
    )
    user = None
    if company is not None:
        user = await db.scalar(
            select(User).where(
                User.company_id == company.id,
                User.employee_code == body.employee_code.strip(),
                User.deleted_at.is_(None),
            )
        )
    log = ActivityLog(
        actor_id=user.id if user else None,
        entity_type="users",
        entity_id=user.id if user else None,
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    if user is not None and await _recent_failures(db, user.id) >= settings.login_max_failures:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Sai mật khẩu quá nhiều lần, thử lại sau {settings.login_lock_minutes} phút",
        )
    # Luôn kiểm tra mật khẩu (hash giả khi không có tài khoản) để không dò được mã công ty / mã nhân viên
    password_ok = verify_password(body.password, user.password_hash if user else None)
    if user is None or not password_ok:
        log.action = LOGIN_FAILED
        log.message = f"Đăng nhập LMS thất bại: {body.company_code} / {body.employee_code}"
        db.add(log)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sai mã công ty, mã nhân viên hoặc mật khẩu",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not company.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Doanh nghiệp đã ngừng hoạt động")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị khoá hoặc ngừng hoạt động")

    log.action = LOGIN
    db.add(log)
    await set_audit_context(db, user.id, log.ip_address)
    user.last_login_at = func.now()
    await db.commit()
    return Token(access_token=create_access_token(user.id, company.id))


@router.get("/me", response_model=MeOut, summary="Nhân viên đang đăng nhập, công ty, vai trò và quyền LMS")
async def me(principal: Principal = Depends(get_current_principal)) -> MeOut:
    return MeOut(
        user=EmployeeOut.model_validate(principal.user),
        company=CompanyBrief.model_validate(principal.company),
        role=principal.role,
        is_system_admin=principal.user.is_system_admin,
        permissions=sorted(principal.permissions),
    )


@router.post("/change-password", response_model=Message, summary="Đổi mật khẩu (dùng chung với Project Manager)")
async def change_password(
    body: PasswordChange,
    principal: Principal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db),
) -> Message:
    user = principal.user
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu hiện tại không đúng")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Message(detail="Đã đổi mật khẩu")

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Company, LmsUserRole, User
from app.models.enums import LmsRole

bearer_scheme = HTTPBearer(auto_error=False, description="Token lấy từ POST /api/v1/auth/login")

# Quyền theo vai trò LMS. Quản trị hệ thống (users.is_system_admin) có mọi quyền + quản lý doanh nghiệp.
ROLE_PERMISSIONS: dict[LmsRole, frozenset[str]] = {
    LmsRole.admin: frozenset({"employee.manage", "content.manage", "enrollment.manage", "report.view"}),
    LmsRole.instructor: frozenset({"content.manage", "enrollment.manage", "report.view"}),
    LmsRole.learner: frozenset(),
}
ALL_PERMISSIONS = frozenset({"company.manage"}).union(*ROLE_PERMISSIONS.values())


@dataclass
class Principal:
    """Người đang đăng nhập LMS: nhân viên + công ty (theo token) + vai trò LMS."""

    user: User
    company: Company
    role: LmsRole

    @property
    def permissions(self) -> frozenset[str]:
        return ALL_PERMISSIONS if self.user.is_system_admin else ROLE_PERMISSIONS[self.role]

    def can(self, code: str) -> bool:
        return code in self.permissions


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def set_audit_context(db: AsyncSession, user_id: int, ip: str | None) -> None:
    """Ngữ cảnh audit: transaction hiện tại set ngay, các transaction sau do event after_begin set."""
    db.info["user_id"] = user_id
    db.info["client_ip"] = ip
    await db.execute(
        text("SELECT set_config('app.current_user_id', :uid, true), set_config('app.client_ip', :ip, true)"),
        {"uid": str(user_id), "ip": ip or ""},
    )


async def get_role(db: AsyncSession, user_id: int) -> LmsRole:
    row = await db.get(LmsUserRole, user_id)
    return row.role if row else LmsRole.learner


async def get_current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Principal:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Không thể xác thực thông tin đăng nhập",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credentials_exception
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise credentials_exception
    try:
        user_id, company_id = int(payload["sub"]), int(payload["cid"])
    except (KeyError, TypeError, ValueError) as exc:
        raise credentials_exception from exc

    user = await db.get(User, user_id)
    # Nhân viên bị chuyển khỏi công ty / bỏ mã nhân viên thì token cũ hết hiệu lực
    if user is None or user.deleted_at is not None or user.company_id != company_id or not user.employee_code:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị khoá hoặc ngừng hoạt động")
    company = await db.get(Company, company_id)
    if company is None or not company.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Doanh nghiệp đã ngừng hoạt động")

    await set_audit_context(db, user.id, client_ip(request))
    return Principal(user=user, company=company, role=await get_role(db, user.id))


def require(code: str) -> Callable:
    """Yêu cầu một quyền LMS (xem ROLE_PERMISSIONS)."""

    async def checker(principal: Principal = Depends(get_current_principal)) -> Principal:
        if not principal.can(code):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Yêu cầu quyền '{code}'")
        return principal

    return checker

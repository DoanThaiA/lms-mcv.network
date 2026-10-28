from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import LmsRole, UserStatus
from app.schemas.common import ORMModel

EMPLOYEE_CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$"
USERNAME_PATTERN = r"^[a-z0-9][a-z0-9_.-]{2,49}$"


class EmployeeBrief(ORMModel):
    id: int
    employee_code: str | None
    full_name: str
    avatar_url: str | None


class EmployeeOut(EmployeeBrief):
    username: str
    email: str
    phone: str | None
    job_title: str | None
    company_id: int | None
    status: UserStatus
    last_login_at: datetime | None
    created_at: datetime


class EmployeeDetail(EmployeeOut):
    role: LmsRole


class EmployeeCreate(BaseModel):
    employee_code: str = Field(pattern=EMPLOYEE_CODE_PATTERN)
    full_name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    # Tên đăng nhập Project Manager; bỏ trống = <mã công ty>.<mã nhân viên> (chữ thường)
    username: str | None = Field(default=None, pattern=USERNAME_PATTERN)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=100)
    role: LmsRole = LmsRole.learner


class EmployeeLink(BaseModel):
    """Gán tài khoản có sẵn (vd: đang dùng Project Manager) vào công ty."""

    user_id: int
    employee_code: str = Field(pattern=EMPLOYEE_CODE_PATTERN)
    role: LmsRole = LmsRole.learner


class EmployeeUpdate(BaseModel):
    employee_code: str | None = Field(default=None, pattern=EMPLOYEE_CODE_PATTERN)
    full_name: str | None = Field(default=None, min_length=1, max_length=150)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=100)
    status: UserStatus | None = None


class RoleSet(BaseModel):
    role: LmsRole


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)

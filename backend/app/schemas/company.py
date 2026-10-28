from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import CompanyStatus
from app.schemas.common import ORMModel

CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,29}$"


class CompanyBrief(ORMModel):
    id: int
    code: str
    name: str
    short_name: str | None
    logo_url: str | None


class CompanyOut(CompanyBrief):
    tax_code: str | None
    email: str | None
    phone: str | None
    address: str | None
    status: CompanyStatus
    created_at: datetime


class CompanyCreate(BaseModel):
    code: str = Field(pattern=CODE_PATTERN, description="Mã công ty, nhân viên nhập khi đăng nhập")
    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=100)
    tax_code: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    logo_url: str | None = Field(default=None, max_length=500)


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=100)
    tax_code: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    logo_url: str | None = Field(default=None, max_length=500)
    status: CompanyStatus | None = None

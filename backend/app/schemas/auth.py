from pydantic import BaseModel, Field

from app.models.enums import LmsRole
from app.schemas.company import CompanyBrief
from app.schemas.employee import EmployeeOut


class LoginRequest(BaseModel):
    company_code: str = Field(min_length=1, max_length=30, examples=["MCV"])
    employee_code: str = Field(min_length=1, max_length=30, examples=["NV001"])
    password: str = Field(min_length=1, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(BaseModel):
    user: EmployeeOut
    company: CompanyBrief
    role: LmsRole
    is_system_admin: bool
    permissions: list[str]


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

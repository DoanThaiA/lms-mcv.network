"""Bảng của project_manager mà LMS dùng chung: companies, users, activity_logs (revision 0008 của project_manager).
Chỉ khai báo các cột LMS cần; schema do migration của project_manager quản lý."""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import CITEXT, INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, pg_enum, str_enum
from app.models.enums import CompanyStatus, LmsRole, UserStatus


class Company(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(CITEXT)
    name: Mapped[str] = mapped_column(String(255))
    short_name: Mapped[str | None] = mapped_column(String(100))
    tax_code: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(CITEXT)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[CompanyStatus] = mapped_column(str_enum(CompanyStatus, 10), default=CompanyStatus.active)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    @property
    def is_active(self) -> bool:
        return self.status == CompanyStatus.active and self.deleted_at is None


class User(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(50))
    email: Mapped[str] = mapped_column(CITEXT)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(30))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    job_title: Mapped[str | None] = mapped_column(String(100))
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("companies.id"))
    employee_code: Mapped[str | None] = mapped_column(CITEXT)
    status: Mapped[UserStatus] = mapped_column(pg_enum(UserStatus, "user_status"), default=UserStatus.active)
    is_system_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_active(self) -> bool:
        return self.status == UserStatus.active and self.deleted_at is None


class LmsUserRole(Base):
    """Vai trò LMS; nhân viên không có dòng ở đây là learner."""

    __tablename__ = "lms_user_roles"
    __table_args__ = {
        "comment": "Vai trò LMS: admin (quản trị LMS công ty), instructor (soạn nội dung, giao khoá học), learner"
    }

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[LmsRole] = mapped_column(str_enum(LmsRole, 20))
    granted_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_id: Mapped[int | None] = mapped_column(BigInteger)
    project_id: Mapped[int | None] = mapped_column(BigInteger)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    action: Mapped[str] = mapped_column(String(30))
    old_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)

"""Lệnh quản trị LMS chạy từ dòng lệnh (khởi tạo doanh nghiệp đầu tiên và quản trị viên của nó).

    python -m app.cli create-company --code MCV --name "Công ty Matching Việt Nam"
    python -m app.cli link-employee --company MCV --username admin --employee-code NV001 --role admin
    python -m app.cli create-employee --company MCV --employee-code NV002 --full-name "Nguyễn Văn A" \\
        --email a@congty.vn --role admin

    python -m app.cli check-storage      # kiểm tra cấu hình Cloudflare R2 (ghi / đọc / xoá thử một file nhỏ)

link-employee gán tài khoản có sẵn (vd: đang dùng Project Manager) vào công ty, giữ nguyên mật khẩu.
create-employee hỏi mật khẩu qua prompt (không hiện trên màn hình), hoặc đọc từ stdin với --password-stdin.
Trong Docker: docker compose exec api python -m app.cli ...
"""

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import delete, or_, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal, engine
from app.models import Company, LmsUserRole, User
from app.models.enums import LmsRole


async def _company(db, code: str) -> Company:
    company = await db.scalar(select(Company).where(Company.code == code, Company.deleted_at.is_(None)))
    if company is None:
        raise ValueError(f"Không có công ty mã '{code}'")
    return company


async def _set_role(db, user_id: int, role: LmsRole) -> None:
    await db.execute(delete(LmsUserRole).where(LmsUserRole.user_id == user_id))
    if role != LmsRole.learner:
        db.add(LmsUserRole(user_id=user_id, role=role))


async def create_company(code: str, name: str) -> Company:
    async with AsyncSessionLocal() as db:
        if await db.scalar(select(Company.id).where(Company.code == code, Company.deleted_at.is_(None))):
            raise ValueError(f"Mã công ty '{code}' đã tồn tại")
        company = Company(code=code, name=name)
        db.add(company)
        await db.commit()
        return company


async def link_employee(company_code: str, username: str, employee_code: str, role: LmsRole) -> User:
    async with AsyncSessionLocal() as db:
        company = await _company(db, company_code)
        user = await db.scalar(
            select(User).where(or_(User.username == username, User.email == username), User.deleted_at.is_(None))
        )
        if user is None:
            raise ValueError(f"Không có tài khoản '{username}'")
        if user.company_id not in (None, company.id):
            raise ValueError("Tài khoản đang thuộc công ty khác")
        user.company_id, user.employee_code = company.id, employee_code
        await _set_role(db, user.id, role)
        await db.commit()
        return user


async def create_employee(
    company_code: str,
    employee_code: str,
    full_name: str,
    email: str,
    username: str | None,
    role: LmsRole,
    password: str,
) -> User:
    if len(password) < 8:
        raise ValueError("Mật khẩu tối thiểu 8 ký tự")
    async with AsyncSessionLocal() as db:
        company = await _company(db, company_code)
        username = username or f"{company.code}.{employee_code}".lower()
        if exists := await db.scalar(select(User.id).where(or_(User.username == username, User.email == email))):
            raise ValueError(f"Username hoặc email đã tồn tại (user id={exists}), dùng link-employee")
        user = User(
            username=username,
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            company_id=company.id,
            employee_code=employee_code,
        )
        db.add(user)
        await db.flush()
        await _set_role(db, user.id, role)
        await db.commit()
        return user


async def check_storage() -> str:
    """Ghi / đọc / xoá thử một object nhỏ trên R2 bằng đúng cấu hình của API."""
    import io

    from app.core.config import settings
    from app.services import file_storage

    if not file_storage.is_configured():
        raise ValueError("Chưa cấu hình R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET")
    key = f"{settings.r2_key_prefix}_healthcheck.txt"
    data = b"lms storage check"
    try:
        await file_storage.upload(key, io.BytesIO(data), len(data), "text/plain")
        info = await file_storage.stat(key)
        await file_storage.delete(key)
    except Exception as exc:  # HTTPException từ file_storage: lấy thông báo gốc
        raise ValueError(getattr(exc, "detail", str(exc))) from exc
    if info is None or info[0] != len(data):
        raise ValueError("Ghi được nhưng không đọc lại được object")
    return f"Cloudflare R2 OK: bucket '{settings.r2_bucket}', prefix '{settings.r2_key_prefix}'"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Lệnh quản trị LMS")
    sub = parser.add_subparsers(dest="command", required=True)

    cc = sub.add_parser("create-company", help="Tạo doanh nghiệp")
    cc.add_argument("--code", required=True, help="Mã công ty (nhập khi đăng nhập)")
    cc.add_argument("--name", required=True)

    roles = [r.value for r in LmsRole]
    le = sub.add_parser("link-employee", help="Gán tài khoản có sẵn vào công ty + mã nhân viên")
    le.add_argument("--company", required=True, help="Mã công ty")
    le.add_argument("--username", required=True, help="Username hoặc email tài khoản có sẵn")
    le.add_argument("--employee-code", required=True)
    le.add_argument("--role", choices=roles, default="learner")

    ce = sub.add_parser("create-employee", help="Tạo tài khoản nhân viên mới")
    ce.add_argument("--company", required=True, help="Mã công ty")
    ce.add_argument("--employee-code", required=True)
    ce.add_argument("--full-name", required=True)
    ce.add_argument("--email", required=True)
    ce.add_argument("--username", help="Bỏ trống = <mã công ty>.<mã nhân viên>")
    ce.add_argument("--role", choices=roles, default="learner")
    ce.add_argument("--password-stdin", action="store_true", help="Đọc mật khẩu từ stdin")
    sub.add_parser("check-storage", help="Kiểm tra cấu hình Cloudflare R2")
    args = parser.parse_args(argv)

    password = ""
    if args.command == "create-employee":
        if args.password_stdin:
            password = sys.stdin.readline().rstrip("\n")
        else:
            password = getpass.getpass("Mật khẩu: ")
            if password != getpass.getpass("Nhập lại mật khẩu: "):
                print("Mật khẩu không khớp", file=sys.stderr)
                return 1

    async def run() -> str:
        try:
            if args.command == "check-storage":
                return await check_storage()
            if args.command == "create-company":
                company = await create_company(args.code, args.name)
                return f"Đã tạo công ty '{company.code}' (id={company.id})"
            if args.command == "link-employee":
                user = await link_employee(args.company, args.username, args.employee_code, LmsRole(args.role))
                return f"Đã gán '{user.username}' vào công ty {args.company}, mã nhân viên {user.employee_code}"
            user = await create_employee(
                args.company,
                args.employee_code,
                args.full_name,
                args.email,
                args.username,
                LmsRole(args.role),
                password,
            )
            return f"Đã tạo nhân viên {user.employee_code} (username '{user.username}', id={user.id})"
        finally:
            await engine.dispose()

    try:
        print(asyncio.run(run()))
    except ValueError as exc:
        print(f"Lỗi: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

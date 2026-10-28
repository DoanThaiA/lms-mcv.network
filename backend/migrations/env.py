"""Môi trường Alembic của LMS: engine async (asyncpg), URL lấy từ cấu hình ứng dụng.

Database dùng chung với project_manager nên LMS có bảng phiên bản riêng `alembic_version_lms`
và chỉ quản lý các bảng tiền tố `lms_`. Bảng users / companies / activity_logs thuộc project_manager.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401  — nạp toàn bộ model vào metadata cho autogenerate
from app.core.config import settings
from app.db.base import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)
target_metadata = Base.metadata
VERSION_TABLE = "alembic_version_lms"


def include_object(obj, name, type_, reflected, compare_to):
    """Chỉ so sánh bảng lms_*; bảng của project_manager (users, companies...) không bao giờ bị đề xuất sửa / xoá.
    Khoá ngoại không so sánh (FK kép, ON DELETE viết trong SQL): tự viết trong migration."""
    if type_ == "foreign_key_constraint":
        return False
    table = obj if type_ == "table" else getattr(obj, "table", None)
    table_name = name if type_ == "table" else getattr(table, "name", "")
    if not table_name.startswith("lms_"):
        return False
    return not (reflected and compare_to is None)


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        include_object=include_object,
        version_table=VERSION_TABLE,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
        version_table=VERSION_TABLE,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(settings.database_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

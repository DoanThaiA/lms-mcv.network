"""Schema LMS: vai trò, danh mục, tài liệu, khoá học, bài học, ghi danh, tiến độ

Nội dung SQL ở migrations/sql/0001_lms_schema.sql. Cần database project_manager đã ở revision 0008
(bảng companies, users.company_id / employee_code) — chạy `alembic upgrade head` bên project_manager trước.

Revision ID: 0001
Revises:
Create Date: 2026-10-27
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import context, op
from sqlalchemy import text
from sqlalchemy.util import await_only

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def run_sql(sql: str) -> None:
    """Nhiều câu lệnh (có $$ ... $$) -> chạy qua kết nối asyncpg gốc, trong transaction của Alembic."""
    if context.is_offline_mode():
        op.execute(sql)
        return
    await_only(op.get_bind().connection.driver_connection.execute(sql))


def upgrade() -> None:
    if not context.is_offline_mode():
        ready = op.get_bind().scalar(
            text(
                "SELECT to_regclass('public.companies') IS NOT NULL AND EXISTS ("
                " SELECT 1 FROM information_schema.columns"
                " WHERE table_name = 'users' AND column_name = 'employee_code')"
            )
        )
        if not ready:
            raise RuntimeError(
                "Database chưa có bảng companies / users.employee_code: "
                "chạy `alembic upgrade head` của project_manager (revision 0008) trước"
            )
    run_sql((SQL_DIR / "0001_lms_schema.sql").read_text())


def downgrade() -> None:
    run_sql("""
DROP TABLE lms_lesson_progress;
DROP TABLE lms_enrollments;
DROP TABLE lms_course_documents;
DROP TABLE lms_lessons;
DROP TABLE lms_courses;
DROP TABLE lms_documents;
DROP TABLE lms_categories;
DROP TABLE lms_user_roles;
""")

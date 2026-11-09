"""Bài học chuẩn: mục tiêu, video, nội dung, câu hỏi kiểm tra, tài liệu thực hành, nộp bài

Nội dung SQL ở migrations/sql/0002_standard_lessons.sql.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-09
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import context, op
from sqlalchemy.util import await_only

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def run_sql(sql: str) -> None:
    """Nhiều câu lệnh -> chạy qua kết nối asyncpg gốc, trong transaction của Alembic (như 0001)."""
    if context.is_offline_mode():
        op.execute(sql)
        return
    await_only(op.get_bind().connection.driver_connection.execute(sql))


def upgrade() -> None:
    run_sql((SQL_DIR / "0002_standard_lessons.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("DELETE FROM lms_lessons WHERE content_type = 'standard'")
    run_sql("""
DROP TABLE lms_lesson_submissions;
DROP TABLE lms_lesson_documents;
ALTER TABLE lms_lesson_progress
    DROP COLUMN video_completed_at, DROP COLUMN quiz_attempts, DROP COLUMN quiz_score, DROP COLUMN quiz_passed_at;
ALTER TABLE lms_lessons
    DROP CONSTRAINT lms_lessons_standard_kind_check,
    DROP CONSTRAINT lms_lessons_quiz_check,
    DROP CONSTRAINT lms_lessons_assignment_check,
    DROP COLUMN lesson_kind, DROP COLUMN goals, DROP COLUMN video_minutes, DROP COLUMN quiz, DROP COLUMN assignment;
ALTER TABLE lms_lessons DROP CONSTRAINT lms_lessons_content_type_check;
ALTER TABLE lms_lessons ADD CONSTRAINT lms_lessons_content_type_check
    CHECK (content_type IN ('text', 'video', 'document', 'link'));
""")

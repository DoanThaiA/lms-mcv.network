"""Test tích hợp trên PostgreSQL thật.

Mỗi lần chạy: tạo lại database `lms_test` trên cùng server với DATABASE_URL, áp migration của project_manager
(alembic upgrade head trong PM_BACKEND_DIR, mặc định ../../project_manager/backend) rồi migration LMS,
nạp db/seeds/01_demo_data.sql. Tài khoản mẫu: mật khẩu Demo@123.
"""

import asyncio
import os
import subprocess
from pathlib import Path
from urllib.parse import quote

import asyncpg
import pytest
from dotenv import dotenv_values
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url

# KHÔNG import app.* ở đầu file: app.core.config đọc .env (database dev) ngay khi import.
BACKEND = Path(__file__).resolve().parents[1]
PM_BACKEND = Path(os.environ.get("PM_BACKEND_DIR", BACKEND.parents[1] / "project_manager/backend"))
TEST_DB = "lms_test"


def _server_dsn() -> str:
    """DSN của server (không kèm tên database): TEST_PG_DSN, hoặc suy ra từ DATABASE_URL (.env)."""
    if dsn := os.environ.get("TEST_PG_DSN"):
        return dsn
    raw = os.environ.get("DATABASE_URL") or dotenv_values(BACKEND / ".env").get("DATABASE_URL")
    if not raw:
        raise RuntimeError("Đặt TEST_PG_DSN hoặc DATABASE_URL (backend/.env) để chạy test")
    url = make_url(raw)
    return f"postgresql://{quote(url.username or '')}:{quote(url.password or '')}@{url.host}:{url.port or 5432}"


PG_DSN = _server_dsn()
TEST_URL = PG_DSN.replace("postgresql://", "postgresql+asyncpg://") + f"/{TEST_DB}"
os.environ["DATABASE_URL"] = TEST_URL

DEMO_SEED = BACKEND.parent / "db/seeds/01_demo_data.sql"
PASSWORD = "Demo@123"


@pytest.fixture(scope="session", autouse=True)
async def database():
    admin = await asyncpg.connect(f"{PG_DSN}/postgres")
    await admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
    await admin.execute(f"CREATE DATABASE {TEST_DB}")
    await admin.execute(f"ALTER DATABASE {TEST_DB} SET timezone TO 'Asia/Ho_Chi_Minh'")
    await admin.close()

    # Schema gốc (users, companies, activity_logs...) do project_manager quản lý
    subprocess.run(
        ["uv", "run", "--quiet", "alembic", "upgrade", "head"],
        cwd=PM_BACKEND,
        env={**os.environ, "DATABASE_URL": TEST_URL},
        check=True,
    )

    from alembic import command
    from alembic.config import Config

    # env.py tự gọi asyncio.run -> chạy trong thread riêng để không đụng event loop của pytest
    await asyncio.to_thread(command.upgrade, Config(BACKEND / "alembic.ini"), "head")

    conn = await asyncpg.connect(f"{PG_DSN}/{TEST_DB}")
    await conn.execute(DEMO_SEED.read_text())
    await conn.close()
    yield


@pytest.fixture(scope="session")
async def client(database):
    from app.db.session import engine
    from app.main import app

    # Chốt an toàn: không bao giờ chạy test trên database dev/production
    assert engine.url.database == TEST_DB, f"Test đang trỏ vào database '{engine.url.database}', dừng lại!"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1") as c:
        yield c


@pytest.fixture(scope="session")
async def login(client):
    cache: dict[tuple[str, str], dict[str, str]] = {}

    async def _login(employee_code: str, company_code: str = "DEMO") -> dict[str, str]:
        key = (company_code, employee_code)
        if key not in cache:
            resp = await client.post(
                "/auth/login",
                json={"company_code": company_code, "employee_code": employee_code, "password": PASSWORD},
            )
            assert resp.status_code == 200, resp.text
            cache[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
        return cache[key]

    return _login


@pytest.fixture(scope="session")
async def employees(client, login) -> dict[str, int]:
    """Mã nhân viên -> user id của công ty DEMO."""
    me = (await client.get("/auth/me", headers=await login("NV001"))).json()
    resp = await client.get(f"/companies/{me['company']['id']}/employees", headers=await login("NV001"))
    return {e["employee_code"]: e["id"] for e in resp.json()["items"]}


@pytest.fixture
def fake_r2(monkeypatch):
    """Thay Cloudflare R2 bằng dict trong bộ nhớ."""
    from app.services import file_storage

    objects: dict[str, tuple[bytes, str]] = {}

    async def upload(key, data, size, content_type):
        content = data.read()
        assert len(content) == size
        objects[key] = (content, content_type)

    async def delete(key):
        objects.pop(key, None)

    async def stat(key):
        return (len(objects[key][0]), objects[key][1]) if key in objects else None

    monkeypatch.setattr(file_storage, "upload", upload)
    monkeypatch.setattr(file_storage, "stat", stat)
    monkeypatch.setattr(file_storage, "upload_url", lambda key: f"https://r2.test/put/{key}")
    monkeypatch.setattr(file_storage, "delete", delete)
    monkeypatch.setattr(file_storage, "download_url", lambda key, name: f"https://r2.test/bucket/{key}")
    monkeypatch.setattr(file_storage, "preview_url", lambda key, name, kind: f"https://r2.test/view/{key}")
    return objects

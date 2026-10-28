from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "LMS MCV API"
    environment: str = "development"
    debug: bool = False

    # Dùng chung database project_manager (server PostgreSQL của ai_carbon_analyst, cổng 5433 chỉ localhost)
    database_url: str = "postgresql+asyncpg://pm_user:CHANGE_ME@localhost:5433/project_manager"

    # Khoá ký JWT riêng của LMS (khác project_manager): token hai hệ thống không dùng lẫn được
    secret_key: str = "change-me-to-a-random-64-char-secret"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 8

    # Chống dò mật khẩu: sai quá N lần trong M phút thì tạm khoá đăng nhập LMS của tài khoản
    login_max_failures: int = 5
    login_lock_minutes: int = 15

    cors_origins: list[str] = ["http://localhost:3001", "http://localhost:5173"]

    # Cloudflare R2 lưu file tài liệu / video bài học; bucket phải có sẵn, để private
    r2_account_id: str = ""
    r2_access_key_id: str = ""  # R2 › Manage API tokens › quyền "Object Read & Write" trên bucket
    r2_secret_access_key: str = ""
    r2_bucket: str = "lms"
    # Bỏ trống = <account_id>.r2.cloudflarestorage.com; bucket ở EU: <account_id>.eu.r2.cloudflarestorage.com
    r2_endpoint: str = ""
    # Object key = <prefix><company_id>/...; prefix cho phép dùng chung bucket với hệ thống khác (vd project_manager)
    r2_key_prefix: str = "lms/"
    # Giới hạn một file (video). Trình duyệt PUT thẳng lên R2: một lần PUT tối đa 5 GB
    file_max_mb: int = 2048
    upload_url_expire_seconds: int = 60 * 60
    file_url_expire_seconds: int = 60 * 60
    # Xem trước Word / Excel / PowerPoint qua Microsoft Office Online: Microsoft tải file qua link ký tạm.
    # Tắt nếu tài liệu không được phép gửi ra ngoài (khi đó các file này chỉ tải về được).
    file_office_preview: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

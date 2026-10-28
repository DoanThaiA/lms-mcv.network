from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.core.config import settings

AUDIENCE = "lms"

# So khớp với hash giả khi không tìm thấy tài khoản: thời gian phản hồi như nhau, không dò được mã nhân viên
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt()).decode()


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    try:
        ok = bcrypt.checkpw(plain_password.encode(), (hashed_password or _DUMMY_HASH).encode())
    except ValueError:  # hash không hợp lệ (vd: 'CHANGE_ME')
        return False
    return ok and hashed_password is not None


def create_access_token(user_id: int, company_id: int, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload: dict[str, Any] = {"sub": str(user_id), "cid": company_id, "aud": AUDIENCE, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm], audience=AUDIENCE)
    except jwt.PyJWTError:
        return None

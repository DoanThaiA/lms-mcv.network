from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def paginate(db: AsyncSession, stmt: Select, page: int, size: int) -> dict[str, Any]:
    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = await db.execute(stmt.limit(size).offset((page - 1) * size))
    return {"items": rows.scalars().all(), "total": total or 0, "page": page, "size": size}


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy {what}")


def unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def apply_update(obj: Any, data: BaseModel) -> dict[str, Any]:
    """Gán các trường client gửi lên (kể cả null), trả về dict đã gán."""
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(obj, field, value)
    return values

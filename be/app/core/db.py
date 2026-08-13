import uuid
from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def generate_prefixed_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def prefixed_id_column(prefix: str) -> Mapped[str]:
    return mapped_column(String(50), primary_key=True, default=lambda: generate_prefixed_id(prefix))


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

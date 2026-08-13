from datetime import datetime
from typing import Any

from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, prefixed_id_column
from app.core.enums import IngestStatus, SourceType


class Project(Base, TimestampMixin):
    """A registered dbt project. Either points at a local directory (``source_ref``
    is the path whose ``target/`` holds manifest.json + catalog.json) or holds
    uploaded artifacts. ``manifest_hash`` gates re-ingestion — unchanged hash is a
    no-op."""

    __tablename__ = "projects"

    id: Mapped[str] = prefixed_id_column("proj")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default=SourceType.PATH)
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)  # filesystem path for PATH projects

    manifest_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=IngestStatus.PENDING)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    # Ingestion summary: counts per resource_type/layer + column-lineage coverage.
    stats: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

from datetime import datetime
from typing import Any

from sqlalchemy import TIMESTAMP, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin

# Operational dbt errors (Airflow build/run/test failures) attributed to a model.
# Stored independently of the lineage graph — keyed by the dbt ``unique_id`` STRING
# (not a FK to ``nodes``) so re-ingesting the manifest (which wholesale-deletes
# ``nodes``) never wipes error history. Cascades only when the project is deleted.

_FK = "projects.id"


class ModelError(Base, TimestampMixin):
    __tablename__ = "model_errors"
    __table_args__ = (
        Index("ix_model_errors_project_node", "project_id", "node_unique_id"),
        Index("ix_model_errors_project_occurred", "project_id", "occurred_at"),
        Index("ix_model_errors_project_category", "project_id", "category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)

    node_unique_id: Mapped[str] = mapped_column(String(500), nullable=False)  # resolved dbt unique_id
    occurred_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)  # ErrorCategory value
    message: Mapped[str] = mapped_column(Text, nullable=False)  # error text / root-cause summary
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)  # run | test | build | compile | ...
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)  # agent context (dag/task/run ids)

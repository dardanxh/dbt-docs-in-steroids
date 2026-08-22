from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.domain.model_errors.models import ModelError


class ModelErrorsRepository:
    def __init__(self, session: Session):
        self.session = session

    def replace_for_node(self, project_id: str, node_unique_id: str, rows: list[dict[str, Any]]) -> int:
        """Delete this node's existing errors, then bulk-insert the new set.
        Returns the number of rows inserted."""
        self.session.execute(
            delete(ModelError).where(
                ModelError.project_id == project_id,
                ModelError.node_unique_id == node_unique_id,
            )
        )
        if rows:
            self.session.execute(insert(ModelError), rows)
        return len(rows)

    def clear(self, project_id: str) -> None:
        self.session.execute(delete(ModelError).where(ModelError.project_id == project_id))

    def by_node(self, project_id: str, node_unique_id: str) -> list[ModelError]:
        stmt = (
            select(ModelError)
            .where(ModelError.project_id == project_id, ModelError.node_unique_id == node_unique_id)
            .order_by(ModelError.occurred_at.desc())
        )
        return list(self.session.scalars(stmt))

    def counts_by_node(self, project_id: str) -> dict[str, int]:
        stmt = (
            select(ModelError.node_unique_id, func.count())
            .where(ModelError.project_id == project_id)
            .group_by(ModelError.node_unique_id)
        )
        return {node_id: count for node_id, count in self.session.execute(stmt)}

    def total(self, project_id: str) -> int:
        stmt = select(func.count()).where(ModelError.project_id == project_id)
        return self.session.scalar(stmt) or 0

    def counts_by_category(self, project_id: str) -> dict[str, int]:
        stmt = (
            select(ModelError.category, func.count())
            .where(ModelError.project_id == project_id)
            .group_by(ModelError.category)
        )
        return {category: count for category, count in self.session.execute(stmt)}

    def counts_over_time(self, project_id: str) -> list[tuple[str, int]]:
        """(YYYY-MM, count) buckets, chronological."""
        month = func.to_char(func.date_trunc("month", ModelError.occurred_at), "YYYY-MM")
        stmt = (
            select(month.label("month"), func.count())
            .where(ModelError.project_id == project_id)
            .group_by("month")
            .order_by("month")
        )
        return [(m, c) for m, c in self.session.execute(stmt)]

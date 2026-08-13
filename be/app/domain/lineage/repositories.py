from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.lineage.models import ColumnEdge, Node, NodeColumn, NodeEdge


class LineageReadRepository:
    def __init__(self, session: Session):
        self.session = session

    def nodes(self, project_id: str) -> list[Node]:
        return list(self.session.scalars(select(Node).where(Node.project_id == project_id)))

    def node(self, project_id: str, unique_id: str) -> Node | None:
        stmt = select(Node).where(Node.project_id == project_id, Node.unique_id == unique_id)
        return self.session.scalars(stmt).first()

    def columns(self, project_id: str, unique_id: str) -> list[NodeColumn]:
        stmt = (
            select(NodeColumn)
            .where(NodeColumn.project_id == project_id, NodeColumn.node_unique_id == unique_id)
            .order_by(NodeColumn.ordinal)
        )
        return list(self.session.scalars(stmt))

    def edges(self, project_id: str) -> list[NodeEdge]:
        return list(self.session.scalars(select(NodeEdge).where(NodeEdge.project_id == project_id)))

    def column_edges(self, project_id: str) -> list[ColumnEdge]:
        return list(self.session.scalars(select(ColumnEdge).where(ColumnEdge.project_id == project_id)))

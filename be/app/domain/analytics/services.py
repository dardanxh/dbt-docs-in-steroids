from __future__ import annotations

from collections import defaultdict

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.domain.analytics.schemas import AnalyticsResponse, MostUsedModel
from app.domain.lineage.repositories import LineageReadRepository
from app.domain.project.repositories import ProjectRepository

_TOP_N = 15


class AnalyticsService:
    def __init__(self, session: Session):
        self.session = session
        self.projects = ProjectRepository(session)
        self.lineage = LineageReadRepository(session)

    def analytics(self, project_id: str) -> AnalyticsResponse:
        project = self.projects.get(project_id)
        if not project:
            raise NotFoundError(f"Project {project_id} not found")
        stats = project.stats or {}
        nodes = self.lineage.nodes(project_id)

        materializations: dict[str, int] = defaultdict(int)
        for n in nodes:
            if n.resource_type == "model":
                materializations[n.materialized or "unknown"] += 1

        models = [n for n in nodes if n.resource_type == "model"]
        most_used = sorted(models, key=lambda n: n.downstream_count, reverse=True)[:_TOP_N]

        return AnalyticsResponse(
            counts=stats.get("counts", {}),
            by_layer=stats.get("by_layer", {}),
            column_lineage=stats.get("column_lineage", {}),
            materializations=dict(materializations),
            node_edges=stats.get("node_edges", 0),
            column_edges=stats.get("column_edges", 0),
            most_used=[
                MostUsedModel(node_id=n.unique_id, name=n.name, layer=n.layer, downstream_count=n.downstream_count)
                for n in most_used
            ],
            dbt_version=stats.get("dbt_version"),
            adapter=stats.get("adapter"),
        )

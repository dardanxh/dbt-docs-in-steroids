from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.domain.analytics.schemas import AnalyticsResponse, MostUsedModel, OwnershipStats, OwnerStat
from app.domain.lineage.models import Node
from app.domain.lineage.repositories import LineageReadRepository
from app.domain.project.repositories import ProjectRepository

_TOP_N = 15
_STALE_DAYS = 365  # a model untouched for this long is "stale"
_CONTESTED_SHARE = 0.5  # no single owner above this share = contested


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
            ownership=self._ownership(models),
            dbt_version=stats.get("dbt_version"),
            adapter=stats.get("adapter"),
        )

    @staticmethod
    def _ownership(models: list[Node]) -> OwnershipStats:
        """Aggregate per-model ownership into a leaderboard + risk summary."""
        owned = [n for n in models if n.owner]
        if not owned:
            return OwnershipStats(tracked=False, leaderboard=[], by_layer={}, risk={})

        counts: dict[str, int] = defaultdict(int)
        share_sum: dict[str, float] = defaultdict(float)
        by_layer: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for n in owned:
            assert n.owner is not None
            counts[n.owner] += 1
            share_sum[n.owner] += n.owner_share or 0.0
            by_layer[n.layer][n.owner] += 1

        leaderboard = [
            OwnerStat(owner=owner, model_count=c, avg_share=share_sum[owner] / c)
            for owner, c in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        ]

        stale_before = datetime.now(UTC) - timedelta(days=_STALE_DAYS)
        risk = {
            "total_models": len(models),
            "orphaned": sum(1 for n in models if not n.owner),
            "solo": sum(1 for n in owned if n.contributor_count == 1),
            "contested": sum(1 for n in owned if (n.owner_share or 0.0) < _CONTESTED_SHARE),
            "stale": sum(1 for n in owned if n.last_modified_at and n.last_modified_at < stale_before),
        }
        return OwnershipStats(
            tracked=True,
            leaderboard=leaderboard,
            by_layer={layer: dict(owners) for layer, owners in by_layer.items()},
            risk=risk,
        )

from __future__ import annotations

from pydantic import BaseModel


class MostUsedModel(BaseModel):
    node_id: str
    name: str
    layer: str
    downstream_count: int


class AnalyticsResponse(BaseModel):
    counts: dict[str, int]  # model/seed/source/test/macro
    by_layer: dict[str, int]  # layer -> node count
    column_lineage: dict[str, int]  # ok/partial/failed/total_models
    materializations: dict[str, int]  # materialized -> count
    node_edges: int
    column_edges: int
    most_used: list[MostUsedModel]
    dbt_version: str | None
    adapter: str | None

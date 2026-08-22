from __future__ import annotations

from pydantic import BaseModel


class MostUsedModel(BaseModel):
    node_id: str
    name: str
    layer: str
    downstream_count: int


class OwnerStat(BaseModel):
    owner: str
    model_count: int
    avg_share: float  # mean ownership share across this owner's models, 0..1


class OwnershipStats(BaseModel):
    tracked: bool  # False when no git ownership is available (upload-mode / non-git)
    leaderboard: list[OwnerStat]  # owners by model_count, desc
    by_layer: dict[str, dict[str, int]]  # layer -> owner -> model_count
    risk: dict[str, int]  # orphaned / solo / contested / stale / total_models


class ErrorProneModel(BaseModel):
    node_id: str
    name: str
    layer: str
    error_count: int


class TimeBucket(BaseModel):
    month: str  # "YYYY-MM"
    count: int


class ErrorAnalytics(BaseModel):
    tracked: bool  # False when no errors have been uploaded
    total: int
    most_error_prone: list[ErrorProneModel]  # top models by error_count, desc
    by_category: dict[str, int]  # ErrorCategory -> count
    over_time: list[TimeBucket]  # chronological monthly buckets


class AnalyticsResponse(BaseModel):
    counts: dict[str, int]  # model/seed/source/test/macro
    by_layer: dict[str, int]  # layer -> node count
    column_lineage: dict[str, int]  # ok/partial/failed/total_models
    materializations: dict[str, int]  # materialized -> count
    node_edges: int
    column_edges: int
    most_used: list[MostUsedModel]
    ownership: OwnershipStats
    errors: ErrorAnalytics
    dbt_version: str | None
    adapter: str | None

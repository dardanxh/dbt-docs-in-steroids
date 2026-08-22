from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NodeMetricsOut(BaseModel):
    fan_in: int
    fan_out: int
    upstream_count: int
    downstream_count: int
    degree_centrality: float
    betweenness: float
    hotspot_score: float
    loc: int
    complexity: float
    cohesion: float
    test_count: int
    column_count: int
    # Git ownership (null for upload-mode / non-git projects).
    owner: str | None = None
    owner_share: float | None = None
    contributor_count: int = 0
    last_author: str | None = None
    last_modified_at: datetime | None = None
    # Operational errors uploaded for this model (0 when none / not tracked).
    error_count: int = 0


class GraphNodeOut(BaseModel):
    id: str  # unique_id
    name: str
    resource_type: str
    layer: str
    materialized: str | None
    column_lineage_status: str | None
    metrics: NodeMetricsOut


class EdgeOut(BaseModel):
    src: str
    dst: str


class LayerOut(BaseModel):
    id: str  # "layer:<name>"
    name: str
    node_ids: list[str]


class LayerEdgeOut(BaseModel):
    src: str  # "layer:<name>"
    dst: str
    count: int


class GraphResponse(BaseModel):
    layers: list[LayerOut]
    nodes: list[GraphNodeOut]
    edges: list[EdgeOut]
    layer_edges: list[LayerEdgeOut]
    coverage: dict[str, int]


class ColumnOut(BaseModel):
    name: str
    data_type: str | None
    description: str | None
    tags: list[str]
    has_lineage: bool


class NodeDetailOut(BaseModel):
    id: str
    name: str
    resource_type: str
    layer: str
    materialized: str | None
    schema_name: str | None
    database_name: str | None
    file_path: str | None
    description: str | None
    tags: list[str]
    metrics: NodeMetricsOut
    columns: list[ColumnOut]
    parents: list[str]
    children: list[str]
    column_lineage_status: str | None
    sql: str | None  # raw model SQL (for the code viewer)


class ColumnUsageItem(BaseModel):
    node_id: str
    used: int  # distinct columns of the shared source consumed across this edge
    total: int  # total columns of that source


class ColumnUsageOut(BaseModel):
    upstream: list[ColumnUsageItem]  # parents feeding this node: used/total of the parent
    downstream: list[ColumnUsageItem]  # children consuming this node: used/total of this node


class ColumnLite(BaseModel):
    name: str
    data_type: str | None
    has_lineage: bool


class MetricValueOut(BaseModel):
    node_id: str
    value: float
    normalized: float


class ColumnRefOut(BaseModel):
    node_id: str
    column: str
    layer: str


class ColumnEdgeOut(BaseModel):
    src: ColumnRefOut
    dst: ColumnRefOut
    transform: str
    confidence: str


class ColumnLineageResponse(BaseModel):
    root: ColumnRefOut
    direction: str
    columns: list[ColumnRefOut]
    edges: list[ColumnEdgeOut]
    source_columns: list[ColumnRefOut]
    partial: bool

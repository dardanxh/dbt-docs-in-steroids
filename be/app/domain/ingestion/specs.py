"""Plain in-memory specs the ingestion pipeline passes between stages.

Deliberately decoupled from SQLAlchemy models: the graph builder and column
parser produce these, and the persistence layer maps them to ORM rows in one
transaction.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.enums import Confidence, Layer, ParseStatus, ResourceType, TransformType


@dataclass
class ColumnSpec:
    name: str
    data_type: str | None = None
    description: str | None = None
    tags: list[str] = field(default_factory=list)
    ordinal: int | None = None


@dataclass
class NodeMetrics:
    fan_in: int = 0
    fan_out: int = 0
    upstream_count: int = 0
    downstream_count: int = 0
    degree_centrality: float = 0.0
    betweenness: float = 0.0
    hotspot_score: float = 0.0
    # Code / quality metrics (heuristics — see graph_builder._compute_code_metrics).
    loc: int = 0  # non-blank lines of raw_code
    complexity: float = 0.0  # weighted SQL construct count
    cohesion: float = 0.0  # 0..1, input concentration proxy (higher = fewer upstreams)
    test_count: int = 0  # tests referencing this node
    column_count: int = 0  # number of columns


@dataclass
class NodeSpec:
    unique_id: str
    name: str
    resource_type: ResourceType
    layer: Layer
    schema: str | None
    database: str | None
    materialized: str | None = None
    file_path: str | None = None
    description: str | None = None
    tags: list[str] = field(default_factory=list)
    columns: list[ColumnSpec] = field(default_factory=list)
    compiled_code: str | None = None
    raw_code: str | None = None
    depends_on: list[str] = field(default_factory=list)
    # (database, schema, table) lowercased — how this node appears in compiled SQL.
    relation_key: tuple[str, str, str] | None = None
    metrics: NodeMetrics = field(default_factory=NodeMetrics)


@dataclass
class ColumnEdgeSpec:
    src_node: str
    src_col: str
    dst_node: str
    dst_col: str
    transform: TransformType = TransformType.DIRECT
    confidence: Confidence = Confidence.HIGH


@dataclass
class DiagnosticSpec:
    node_unique_id: str
    status: ParseStatus
    reason: str | None = None
    unresolved_columns: list[str] = field(default_factory=list)


@dataclass
class BuiltGraph:
    nodes: dict[str, NodeSpec]
    edges: list[tuple[str, str]]  # (src_unique_id, dst_unique_id)
    # sqlglot schema: {db: {schema: {table: {col: type}}}}
    sqlglot_schema: dict[str, dict[str, dict[str, dict[str, str]]]]
    # (db, schema, table) lowercased -> unique_id, for mapping parsed tables back.
    relation_index: dict[tuple[str, str, str], str]
    # For rendering raw_code when compiled_code is absent (dbt-parse manifests):
    ref_relations: dict[str, str] = field(default_factory=dict)  # model/seed name -> relation_name
    source_relations: dict[tuple[str, str], str] = field(default_factory=dict)  # (source, table) -> relation_name

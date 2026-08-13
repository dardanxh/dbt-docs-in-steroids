from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# These tables hold the *precomputed* lineage graph for a project. Ingestion
# writes them once (per manifest_hash); every read endpoint is a pure query.
# Child rows are keyed by the dbt ``unique_id`` string (stable within a project),
# not by a surrogate FK, so the graph-builder can insert them without a second
# round-trip to resolve ids.

_FK = "projects.id"


class Node(Base):
    __tablename__ = "nodes"
    __table_args__ = (
        UniqueConstraint("project_id", "unique_id", name="uq_nodes_project_unique_id"),
        Index("ix_nodes_project_layer", "project_id", "layer"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)

    unique_id: Mapped[str] = mapped_column(String(500), nullable=False)  # e.g. model.dwh.bill_currency
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # model | seed | source
    layer: Mapped[str] = mapped_column(String(20), nullable=False)
    materialized: Mapped[str | None] = mapped_column(String(30), nullable=True)
    schema_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    database_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    raw_code: Mapped[str | None] = mapped_column(Text, nullable=True)  # model SQL (for the code viewer)

    # Hotspot metrics (computed from the node graph). Stored as columns so the
    # API can sort/filter without deserializing JSON.
    fan_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fan_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upstream_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downstream_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    degree_centrality: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    betweenness: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    hotspot_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Code / quality metrics (heuristics).
    loc: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    complexity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cohesion: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    test_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    column_lineage_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ok | partial | failed


class NodeColumn(Base):
    __tablename__ = "node_columns"
    __table_args__ = (
        UniqueConstraint("project_id", "node_unique_id", "name", name="uq_node_columns_node_name"),
        Index("ix_node_columns_project_node", "project_id", "node_unique_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)
    node_unique_id: Mapped[str] = mapped_column(String(500), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    data_type: Mapped[str | None] = mapped_column(Text, nullable=True)  # BigQuery STRUCT/ARRAY types can be very long
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    ordinal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_lineage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0/1 — any column_edge points at it


class NodeEdge(Base):
    __tablename__ = "node_edges"
    __table_args__ = (
        UniqueConstraint("project_id", "src_id", "dst_id", name="uq_node_edges"),
        Index("ix_node_edges_project", "project_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)
    src_id: Mapped[str] = mapped_column(String(500), nullable=False)  # upstream unique_id
    dst_id: Mapped[str] = mapped_column(String(500), nullable=False)  # downstream unique_id


class ColumnEdge(Base):
    __tablename__ = "column_edges"
    __table_args__ = (
        Index("ix_column_edges_dst", "project_id", "dst_node", "dst_col"),
        Index("ix_column_edges_src", "project_id", "src_node", "src_col"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)
    src_node: Mapped[str] = mapped_column(String(500), nullable=False)
    src_col: Mapped[str] = mapped_column(String(300), nullable=False)
    dst_node: Mapped[str] = mapped_column(String(500), nullable=False)
    dst_col: Mapped[str] = mapped_column(String(300), nullable=False)
    transform: Mapped[str] = mapped_column(String(20), nullable=False)  # direct | derived | aggregate | unknown
    confidence: Mapped[str] = mapped_column(String(10), nullable=False)  # high | low


class ParseDiagnostic(Base):
    __tablename__ = "parse_diagnostics"
    __table_args__ = (Index("ix_parse_diagnostics_project", "project_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(50), ForeignKey(_FK, ondelete="CASCADE"), nullable=False, index=True)
    node_unique_id: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # ok | partial | failed
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    unresolved_columns: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

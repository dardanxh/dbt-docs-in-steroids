"""Bulk persistence of a built graph into the lineage tables.

Writes are wholesale per project: delete the project's existing rows, then bulk
insert the freshly built graph. Keeps re-ingestion simple (no diffing) and is
plenty fast at dbt-project scale (hundreds of nodes, thousands of edges).
"""

from __future__ import annotations

from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app.domain.ingestion.specs import BuiltGraph, ColumnEdgeSpec, DiagnosticSpec
from app.domain.lineage.models import ColumnEdge, Node, NodeColumn, NodeEdge, ParseDiagnostic


class LineagePersistenceRepository:
    def __init__(self, session: Session):
        self.session = session

    def clear(self, project_id: str) -> None:
        for model in (ColumnEdge, NodeEdge, NodeColumn, ParseDiagnostic, Node):
            self.session.execute(delete(model).where(model.project_id == project_id))

    def persist(
        self,
        project_id: str,
        graph: BuiltGraph,
        column_edges: list[ColumnEdgeSpec],
        diagnostics: list[DiagnosticSpec],
    ) -> None:
        self.clear(project_id)

        status_by_node = {d.node_unique_id: d.status.value for d in diagnostics}
        has_lineage = {(e.dst_node, e.dst_col) for e in column_edges}

        node_rows = []
        column_rows = []
        for node in graph.nodes.values():
            m = node.metrics
            node_rows.append(
                {
                    "project_id": project_id,
                    "unique_id": node.unique_id,
                    "name": node.name,
                    "resource_type": node.resource_type.value,
                    "layer": node.layer.value,
                    "materialized": node.materialized,
                    "schema_name": node.schema,
                    "database_name": node.database,
                    "file_path": node.file_path,
                    "description": node.description,
                    "tags": node.tags,
                    "raw_code": node.raw_code,
                    "fan_in": m.fan_in,
                    "fan_out": m.fan_out,
                    "upstream_count": m.upstream_count,
                    "downstream_count": m.downstream_count,
                    "degree_centrality": m.degree_centrality,
                    "betweenness": m.betweenness,
                    "hotspot_score": m.hotspot_score,
                    "loc": m.loc,
                    "complexity": m.complexity,
                    "cohesion": m.cohesion,
                    "test_count": m.test_count,
                    "column_count": m.column_count,
                    "column_lineage_status": status_by_node.get(node.unique_id),
                }
            )
            for col in node.columns:
                column_rows.append(
                    {
                        "project_id": project_id,
                        "node_unique_id": node.unique_id,
                        "name": col.name,
                        "data_type": col.data_type,
                        "description": col.description,
                        "tags": col.tags,
                        "ordinal": col.ordinal,
                        "has_lineage": 1 if (node.unique_id, col.name.lower()) in has_lineage else 0,
                    }
                )

        edge_rows = [{"project_id": project_id, "src_id": s, "dst_id": d} for s, d in graph.edges]
        column_edge_rows = [
            {
                "project_id": project_id,
                "src_node": e.src_node,
                "src_col": e.src_col,
                "dst_node": e.dst_node,
                "dst_col": e.dst_col,
                "transform": e.transform.value,
                "confidence": e.confidence.value,
            }
            for e in column_edges
        ]
        diagnostic_rows = [
            {
                "project_id": project_id,
                "node_unique_id": d.node_unique_id,
                "status": d.status.value,
                "reason": d.reason,
                "unresolved_columns": d.unresolved_columns,
            }
            for d in diagnostics
        ]

        if node_rows:
            self.session.execute(insert(Node), node_rows)
        if column_rows:
            self.session.execute(insert(NodeColumn), column_rows)
        if edge_rows:
            self.session.execute(insert(NodeEdge), edge_rows)
        if column_edge_rows:
            self.session.execute(insert(ColumnEdge), column_edge_rows)
        if diagnostic_rows:
            self.session.execute(insert(ParseDiagnostic), diagnostic_rows)

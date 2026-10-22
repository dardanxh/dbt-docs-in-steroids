"""Unused columns: output columns of a model that no downstream model reads.

Computed after column lineage, from the column edges (a column is "read" if any
column edge has it as its source). Only reported when it can be trusted: the
model must have downstream models and *every* one of them must have fully
resolved column lineage (status OK). Otherwise an unparsed consumer could be
reading a column we'd wrongly call unused, so the count stays unknown.
Leaf models (nothing downstream) are unknown too — their consumers are BI tools,
not dbt.
"""

from __future__ import annotations

from collections import defaultdict

from app.core.enums import ParseStatus, ResourceType
from app.domain.ingestion.specs import BuiltGraph, ColumnEdgeSpec, DiagnosticSpec


def attach_unused_columns(
    graph: BuiltGraph, column_edges: list[ColumnEdgeSpec], diagnostics: list[DiagnosticSpec]
) -> None:
    status = {d.node_unique_id: d.status for d in diagnostics}
    children: dict[str, list[str]] = defaultdict(list)
    for src, dst in graph.edges:
        children[src].append(dst)
    read: dict[str, set[str]] = defaultdict(set)
    for e in column_edges:
        read[e.src_node].add(e.src_col.lower())

    for uid, node in graph.nodes.items():
        if node.resource_type != ResourceType.MODEL or not node.columns:
            continue
        kids = children.get(uid, [])
        if not kids or any(status.get(k) != ParseStatus.OK for k in kids):
            continue
        node.metrics.unused_columns_known = True
        node.metrics.unused_column_count = sum(1 for c in node.columns if c.name.lower() not in read[uid])

"""Standalone sanity check: run the ingestion pipeline against a real dbt project
WITHOUT Postgres. Prints node/edge counts, column-lineage coverage, and a couple
of sample column traces. Usage: uv run python scripts/verify_parse.py [PROJECT_PATH]"""

import os
import sys
from collections import defaultdict

from app.domain.ingestion.artifacts import load_from_path
from app.domain.ingestion.column_lineage import build_column_edges
from app.domain.ingestion.graph_builder import build_graph

path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEFAULT_DBT_PROJECT_PATH", ".")
bundle = load_from_path(path)
print(f"dbt {bundle.dbt_version} / adapter={bundle.adapter} / manifest_hash={bundle.manifest_hash[:12]}")

graph = build_graph(bundle)
by_layer: dict[str, int] = defaultdict(int)
by_type: dict[str, int] = defaultdict(int)
for n in graph.nodes.values():
    by_layer[n.layer.value] += 1
    by_type[n.resource_type.value] += 1
print(f"\nnodes={len(graph.nodes)} edges={len(graph.edges)}")
print("by_type:", dict(by_type))
print("by_layer:", dict(by_layer))

top = sorted(graph.nodes.values(), key=lambda n: n.metrics.downstream_count, reverse=True)[:5]
print("\ntop hotspots (downstream_count):")
for n in top:
    print(f"  {n.metrics.downstream_count:4d}  {n.unique_id}")

col_edges, diags = build_column_edges(graph)
status: dict[str, int] = defaultdict(int)
for d in diags:
    status[d.status.value] += 1
print(f"\ncolumn_edges={len(col_edges)}  model parse status: {dict(status)}")

# Show a sample resolved model + one of its column's upstream edges.
sample = next((d for d in diags if d.status.value == "ok"), None)
if sample:
    print(f"\nsample OK model: {sample.node_unique_id}")
    for e in [e for e in col_edges if e.dst_node == sample.node_unique_id][:6]:
        print(f"  {e.dst_col:<28} <- {e.src_node}::{e.src_col}  [{e.transform.value}/{e.confidence.value}]")

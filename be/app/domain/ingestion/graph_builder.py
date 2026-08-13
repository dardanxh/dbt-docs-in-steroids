"""Build the node graph + hotspot metrics from a dbt ArtifactBundle.

Node-level lineage comes straight from the manifest's ``depends_on``/``child_map``;
column metadata is merged from manifest (descriptions/tags) + catalog (types).
Metrics are computed with networkx on the assembled DiGraph.
"""

from __future__ import annotations

import re
from typing import Any

import networkx as nx

from app.core.enums import Layer, ResourceType
from app.domain.ingestion.artifacts import ArtifactBundle
from app.domain.ingestion.specs import BuiltGraph, ColumnSpec, NodeMetrics, NodeSpec

_KNOWN_LAYERS = {layer.value for layer in Layer}


def _derive_layer(resource_type: ResourceType, fqn: list[str] | None, file_path: str | None) -> Layer:
    if resource_type == ResourceType.SOURCE:
        return Layer.SOURCE
    # Prefer the top model folder from the file path: models/<layer>/....
    if file_path:
        parts = file_path.split("/")
        if len(parts) >= 2 and parts[0] == "models" and parts[1] in _KNOWN_LAYERS:
            return Layer(parts[1])
    # Fall back to fqn[1] (fqn[0] is the package name).
    if fqn and len(fqn) >= 2 and fqn[1] in _KNOWN_LAYERS:
        return Layer(fqn[1])
    return Layer.OTHER


def _merge_columns(manifest_cols: dict[str, Any], catalog_cols: dict[str, Any]) -> list[ColumnSpec]:
    """Catalog wins on data_type; manifest wins on description/tags."""
    specs: dict[str, ColumnSpec] = {}
    for name, col in (manifest_cols or {}).items():
        specs[name.lower()] = ColumnSpec(
            name=name,
            data_type=col.get("data_type"),
            description=col.get("description") or None,
            tags=list(col.get("tags") or []),
        )
    for name, col in (catalog_cols or {}).items():
        key = name.lower()
        existing = specs.get(key)
        col_type = col.get("type")
        comment = col.get("comment") or None
        index = col.get("index")
        if existing:
            if col_type:
                existing.data_type = col_type
            if existing.description is None:
                existing.description = comment
            existing.ordinal = index
        else:
            specs[key] = ColumnSpec(name=name, data_type=col_type, description=comment, ordinal=index)
    ordered = sorted(specs.values(), key=lambda c: (c.ordinal is None, c.ordinal or 0, c.name))
    for i, spec in enumerate(ordered):
        if spec.ordinal is None:
            spec.ordinal = i
    return ordered


def _relation_key(database: str | None, schema: str | None, table: str | None) -> tuple[str, str, str]:
    return ((database or "").lower(), (schema or "").lower(), (table or "").lower())


def build_graph(bundle: ArtifactBundle) -> BuiltGraph:
    manifest = bundle.manifest
    catalog = bundle.catalog
    catalog_nodes = catalog.get("nodes", {})
    catalog_sources = catalog.get("sources", {})

    nodes: dict[str, NodeSpec] = {}
    # Name -> physical relation, for resolving {{ ref() }} / {{ source() }} when a
    # manifest carries no compiled_code (see jinja_render).
    ref_relations: dict[str, str] = {}
    source_relations: dict[tuple[str, str], str] = {}

    # --- models + seeds ---
    for uid, node in manifest.get("nodes", {}).items():
        rtype = node.get("resource_type")
        if rtype not in ("model", "seed"):
            continue  # skip tests, unit_tests, analyses, operations, etc.
        resource_type = ResourceType(rtype)
        config = node.get("config") or {}
        alias = node.get("alias") or node.get("name")
        database = node.get("database")
        schema = node.get("schema")
        cat_cols = (catalog_nodes.get(uid) or {}).get("columns", {})
        nodes[uid] = NodeSpec(
            unique_id=uid,
            name=node.get("name", uid),
            resource_type=resource_type,
            layer=_derive_layer(resource_type, node.get("fqn"), node.get("original_file_path")),
            schema=schema,
            database=database,
            materialized=config.get("materialized"),
            file_path=node.get("original_file_path"),
            description=node.get("description") or None,
            tags=list(node.get("tags") or []),
            columns=_merge_columns(node.get("columns", {}), cat_cols),
            compiled_code=node.get("compiled_code") or None,
            raw_code=node.get("raw_code") or None,
            depends_on=list((node.get("depends_on") or {}).get("nodes") or []),
            relation_key=_relation_key(database, schema, alias),
        )
        if node.get("relation_name"):
            ref_relations[node.get("name", uid)] = node["relation_name"]

    # --- sources ---
    for uid, src in manifest.get("sources", {}).items():
        database = src.get("database")
        schema = src.get("schema")
        identifier = src.get("identifier") or src.get("name")
        cat_cols = (catalog_sources.get(uid) or {}).get("columns", {})
        nodes[uid] = NodeSpec(
            unique_id=uid,
            name=f"{src.get('source_name', '')}.{src.get('name', uid)}".strip("."),
            resource_type=ResourceType.SOURCE,
            layer=Layer.SOURCE,
            schema=schema,
            database=database,
            materialized=None,
            file_path=src.get("original_file_path"),
            description=src.get("description") or None,
            tags=list(src.get("tags") or []),
            columns=_merge_columns(src.get("columns", {}), cat_cols),
            compiled_code=None,
            raw_code=None,
            depends_on=[],
            relation_key=_relation_key(database, schema, identifier),
        )
        if src.get("relation_name"):
            source_relations[(src.get("source_name", ""), src.get("name", ""))] = src["relation_name"]

    # --- edges (only between nodes we kept) ---
    edges: list[tuple[str, str]] = []
    for uid, node in nodes.items():
        for parent in node.depends_on:
            if parent in nodes:
                edges.append((parent, uid))

    _compute_metrics(nodes, edges)
    _compute_code_metrics(nodes, manifest)

    # --- sqlglot schema + relation index ---
    schema_tree: dict[str, dict[str, dict[str, dict[str, str]]]] = {}
    relation_index: dict[tuple[str, str, str], str] = {}
    for uid, node in nodes.items():
        if not node.relation_key:
            continue
        db, sch, tbl = node.relation_key
        relation_index[node.relation_key] = uid
        cols = {c.name: (c.data_type or "UNKNOWN") for c in node.columns}
        if cols:
            schema_tree.setdefault(db, {}).setdefault(sch, {})[tbl] = cols

    return BuiltGraph(
        nodes=nodes,
        edges=edges,
        sqlglot_schema=schema_tree,
        relation_index=relation_index,
        ref_relations=ref_relations,
        source_relations=source_relations,
    )


def _compute_metrics(nodes: dict[str, NodeSpec], edges: list[tuple[str, str]]) -> None:
    graph = nx.DiGraph()
    graph.add_nodes_from(nodes.keys())
    graph.add_edges_from(edges)

    degree_centrality = nx.degree_centrality(graph) if len(nodes) > 1 else {}
    try:
        betweenness = nx.betweenness_centrality(graph)
    except Exception:
        betweenness = {}

    downstream_counts: dict[str, int] = {}
    for uid in nodes:
        fan_in = graph.in_degree(uid)
        fan_out = graph.out_degree(uid)
        downstream = len(nx.descendants(graph, uid))
        upstream = len(nx.ancestors(graph, uid))
        downstream_counts[uid] = downstream
        nodes[uid].metrics = NodeMetrics(
            fan_in=int(fan_in),
            fan_out=int(fan_out),
            upstream_count=upstream,
            downstream_count=downstream,
            degree_centrality=float(degree_centrality.get(uid, 0.0)),
            betweenness=float(betweenness.get(uid, 0.0)),
        )

    # hotspot_score = min-max normalized downstream_count ("how used is this").
    max_down = max(downstream_counts.values(), default=0)
    for uid in nodes:
        nodes[uid].metrics.hotspot_score = (downstream_counts[uid] / max_down) if max_down else 0.0


# Weighted SQL constructs for the complexity heuristic. Works on raw_code (with
# Jinja) since it's keyword-based — robust for `dbt parse` manifests where most
# models have no compiled SQL to parse via sqlglot.
_COMPLEXITY_PATTERNS: list[tuple[re.Pattern[str], float]] = [
    (re.compile(r"\bjoin\b", re.I), 2.0),
    (re.compile(r"\bover\s*\(", re.I), 3.0),  # window functions
    (re.compile(r"\bcase\s+when\b", re.I), 1.0),
    (re.compile(r"\bunion\b", re.I), 2.0),
    (re.compile(r"\bgroup\s+by\b", re.I), 1.0),
    (re.compile(r"\bhaving\b", re.I), 1.0),
    (re.compile(r"\bdistinct\b", re.I), 1.0),
    (re.compile(r"\(\s*select\b", re.I), 2.0),  # subqueries
    (re.compile(r"\bwith\b|\)\s*,\s*\w+\s+as\s*\(", re.I), 2.0),  # CTE definitions
]


def _keyword_complexity(sql: str) -> float:
    return round(sum(weight * len(pat.findall(sql)) for pat, weight in _COMPLEXITY_PATTERNS), 2)


def _compute_code_metrics(nodes: dict[str, NodeSpec], manifest: dict[str, Any]) -> None:
    """LOC, complexity, cohesion, column_count, test_count (heuristics)."""
    for node in nodes.values():
        node.metrics.column_count = len(node.columns)
        if node.resource_type == ResourceType.MODEL and node.raw_code:
            node.metrics.loc = sum(1 for ln in node.raw_code.splitlines() if ln.strip())
            node.metrics.complexity = _keyword_complexity(node.raw_code)
            distinct_upstreams = len({d for d in node.depends_on if d in nodes})
            node.metrics.cohesion = round(1.0 / max(1, distinct_upstreams), 3)

    # Tests reference the models/sources they cover via depends_on.nodes.
    for raw in manifest.get("nodes", {}).values():
        if raw.get("resource_type") not in ("test", "unit_test"):
            continue
        for uid in (raw.get("depends_on") or {}).get("nodes") or []:
            target = nodes.get(uid)
            if target is not None:
                target.metrics.test_count += 1

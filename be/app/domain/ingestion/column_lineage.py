"""Column-level lineage via sqlglot.

Strategy (see plan): parse each model's ``compiled_code`` (Jinja already
rendered) ONE HOP at a time — for every declared output column, ask sqlglot to
trace it back to the columns of this model's *direct upstream tables*. The full
multi-layer trace is a graph traversal over the stored column edges (done at
read time), not a cross-DAG sqlglot call. This bounds parse complexity and keeps
one bad model from poisoning the rest.

A fallback ladder degrades gracefully and every node gets a ParseDiagnostic so
the UI can report honest coverage.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import cast

import sqlglot
from sqlglot import exp
from sqlglot.lineage import Node as LineageNode
from sqlglot.lineage import lineage

from app.core.enums import Confidence, ParseStatus, ResourceType, TransformType
from app.domain.ingestion.jinja_render import has_residual_jinja, render
from app.domain.ingestion.specs import BuiltGraph, ColumnEdgeSpec, DiagnosticSpec, NodeSpec

logger = logging.getLogger(__name__)

_DIALECT = "bigquery"

# sqlglot schema shape: {db: {schema: {table: {column: type}}}}
SqlglotSchema = dict[str, dict[str, dict[str, dict[str, str]]]]


def build_column_edges(graph: BuiltGraph) -> tuple[list[ColumnEdgeSpec], list[DiagnosticSpec]]:
    edges: list[ColumnEdgeSpec] = []
    diagnostics: list[DiagnosticSpec] = []
    schema = graph.sqlglot_schema

    for node in graph.nodes.values():
        if node.resource_type != ResourceType.MODEL:
            continue  # sources/seeds are leaves — no SQL to parse
        node_edges, diag = _process_model(node, schema, graph)
        edges.extend(node_edges)
        diagnostics.append(diag)

    return edges, diagnostics


def _resolve_sql(node: NodeSpec, graph: BuiltGraph) -> tuple[str | None, str | None]:
    """Return (sql, failure_reason). Prefer compiled_code; otherwise render
    raw_code's ref/source/config against the manifest's known relations."""
    if node.compiled_code:
        return node.compiled_code, None
    if not node.raw_code:
        return None, "No compiled_code or raw_code."
    rendered = render(node.raw_code, graph.ref_relations, graph.source_relations)
    if has_residual_jinja(rendered):
        return None, "Unrendered Jinja (macros/var/control-flow); provide compiled artifacts for full lineage."
    return rendered, None


def _process_model(
    node: NodeSpec,
    schema: SqlglotSchema,
    graph: BuiltGraph,
) -> tuple[list[ColumnEdgeSpec], DiagnosticSpec]:
    relation_index = graph.relation_index
    sql, reason = _resolve_sql(node, graph)
    if sql is None:
        return [], DiagnosticSpec(node.unique_id, ParseStatus.FAILED, reason=reason)

    try:
        # parse_one returns a TypeVar (Expr) that mypy won't unify with Expression;
        # it's always an Expression subclass at runtime, so cast the local type.
        tree = cast(exp.Expression, sqlglot.parse_one(sql, dialect=_DIALECT))
    except Exception as exc:  # noqa: BLE001 — any parse failure degrades to node-level
        return [], DiagnosticSpec(node.unique_id, ParseStatus.FAILED, reason=f"parse error: {exc}")

    out_columns = [c.name for c in node.columns] or _output_columns(tree)
    if not out_columns:
        return [], DiagnosticSpec(node.unique_id, ParseStatus.FAILED, reason="no resolvable output columns")

    edges: list[ColumnEdgeSpec] = []
    seen: set[tuple[str, str, str, str]] = set()
    unresolved: list[str] = []
    ok_cols = 0

    for col in out_columns:
        root, confidence = _trace(col, tree, schema)
        if root is None:
            unresolved.append(col)
            continue
        transform = _classify(cast("exp.Expression | None", root.expression))
        col_edges = _edges_from_leaves(root, node.unique_id, col, transform, confidence, relation_index, seen)
        if col_edges:
            ok_cols += 1
            edges.extend(col_edges)
        else:
            unresolved.append(col)

    if ok_cols == 0:
        status = ParseStatus.FAILED
    elif unresolved:
        status = ParseStatus.PARTIAL
    else:
        status = ParseStatus.OK

    reason = None if not unresolved else f"{len(unresolved)}/{len(out_columns)} columns unresolved"
    return edges, DiagnosticSpec(node.unique_id, status, reason=reason, unresolved_columns=unresolved)


def _trace(column: str, tree: exp.Expression, schema: SqlglotSchema) -> tuple[LineageNode | None, Confidence]:
    """Trace one output column. Prefer schema-qualified (HIGH); fall back to
    schema-less (LOW); give up → (None, HIGH-unused)."""
    try:
        return lineage(column, tree.copy(), schema=schema, dialect=_DIALECT), Confidence.HIGH
    except Exception:  # noqa: BLE001
        try:
            return lineage(column, tree.copy(), dialect=_DIALECT), Confidence.LOW
        except Exception:  # noqa: BLE001
            return None, Confidence.HIGH


def _edges_from_leaves(
    root: LineageNode,
    dst_node: str,
    dst_col: str,
    transform: TransformType,
    confidence: Confidence,
    relation_index: dict[tuple[str, str, str], str],
    seen: set[tuple[str, str, str, str]],
) -> list[ColumnEdgeSpec]:
    edges: list[ColumnEdgeSpec] = []
    for leaf in _leaves(root):
        source = leaf.source
        if not isinstance(source, exp.Table):
            continue
        key = ((source.catalog or "").lower(), (source.db or "").lower(), (source.name or "").lower())
        src_uid = relation_index.get(key)
        if not src_uid:
            continue  # references a CTE/unknown relation — not a model boundary
        src_col = leaf.name.split(".")[-1].strip('"`').lower()
        if not src_col or src_col == "*":
            continue
        dedup = (src_uid, src_col, dst_node, dst_col.lower())
        if dedup in seen:
            continue
        seen.add(dedup)
        edges.append(
            ColumnEdgeSpec(
                src_node=src_uid,
                src_col=src_col,
                dst_node=dst_node,
                dst_col=dst_col.lower(),
                transform=transform,
                confidence=confidence,
            )
        )
    return edges


def _leaves(node: LineageNode) -> Iterator[LineageNode]:
    if not node.downstream:
        yield node
        return
    for child in node.downstream:
        yield from _leaves(child)


def _classify(expression: exp.Expression | None) -> TransformType:
    if expression is None:
        return TransformType.UNKNOWN
    expr = expression
    if isinstance(expr, exp.Alias):
        expr = expr.this
    if isinstance(expr, exp.Column):
        return TransformType.DIRECT
    if list(expr.find_all(exp.AggFunc)):
        return TransformType.AGGREGATE
    if list(expr.find_all(exp.Column)):
        return TransformType.DERIVED
    return TransformType.UNKNOWN


def _output_columns(tree: exp.Expression) -> list[str]:
    """Best-effort output column names when the node has no declared columns."""
    select = tree.find(exp.Select)
    if select is None:
        return []
    names: list[str] = []
    for projection in select.expressions:
        name = projection.alias_or_name
        if name and name != "*":
            names.append(name)
    return names

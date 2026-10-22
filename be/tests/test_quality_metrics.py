"""Doc coverage, unused columns and the redundancy finder (deterministic)."""

from __future__ import annotations

from app.core.enums import Layer, ParseStatus, ResourceType
from app.domain.ingestion.artifacts import ArtifactBundle
from app.domain.ingestion.column_usage import attach_unused_columns
from app.domain.ingestion.graph_builder import build_graph
from app.domain.ingestion.specs import BuiltGraph, ColumnEdgeSpec, ColumnSpec, DiagnosticSpec, NodeSpec
from app.domain.lineage.redundancy import ModelInput, find_redundant, jaccard, shingles


def _manifest_node(name: str, description: str, columns: dict[str, str]) -> dict[str, object]:
    return {
        "resource_type": "model",
        "name": name,
        "database": "db",
        "schema": "sch",
        "alias": name,
        "config": {"materialized": "table"},
        "original_file_path": f"models/dwh/{name}.sql",
        "fqn": ["proj", "dwh", name],
        "description": description,
        "columns": {c: {"name": c, "description": d} for c, d in columns.items()},
        "depends_on": {"nodes": []},
    }


def test_doc_coverage_counts_model_description_and_columns() -> None:
    manifest = {
        "metadata": {"dbt_version": "1.9.0", "adapter_type": "postgres"},
        "nodes": {
            # description + 1 of 3 columns documented -> 2 / 4
            "model.proj.half": _manifest_node("half", "A model", {"a": "the a", "b": "", "c": ""}),
            "model.proj.none": _manifest_node("none", "", {"a": ""}),
        },
        "sources": {},
    }
    graph = build_graph(ArtifactBundle(manifest=manifest))
    assert graph.nodes["model.proj.half"].metrics.doc_coverage == 0.5
    assert graph.nodes["model.proj.none"].metrics.doc_coverage == 0.0


def _spec(uid: str, cols: list[str]) -> NodeSpec:
    return NodeSpec(
        unique_id=uid,
        name=uid,
        resource_type=ResourceType.MODEL,
        layer=Layer.DWH,
        schema="sch",
        database="db",
        columns=[ColumnSpec(name=c) for c in cols],
    )


def _graph(nodes: list[NodeSpec], edges: list[tuple[str, str]]) -> BuiltGraph:
    return BuiltGraph(nodes={n.unique_id: n for n in nodes}, edges=edges, sqlglot_schema={}, relation_index={})


def test_unused_columns_known_only_when_all_consumers_parsed() -> None:
    parent = _spec("p", ["id", "amount", "legacy_flag"])
    child_ok = _spec("c1", ["id", "amount"])
    graph = _graph([parent, child_ok], [("p", "c1")])
    edges = [ColumnEdgeSpec("p", "id", "c1", "id"), ColumnEdgeSpec("p", "AMOUNT", "c1", "amount")]
    attach_unused_columns(graph, edges, [DiagnosticSpec("c1", ParseStatus.OK)])
    assert parent.metrics.unused_columns_known
    assert parent.metrics.unused_column_count == 1  # legacy_flag

    # A partially parsed consumer makes the count unknown (it might read legacy_flag).
    parent2 = _spec("p", ["id", "legacy_flag"])
    graph2 = _graph([parent2, _spec("c1", ["id"])], [("p", "c1")])
    attach_unused_columns(graph2, edges, [DiagnosticSpec("c1", ParseStatus.PARTIAL)])
    assert not parent2.metrics.unused_columns_known
    assert parent2.metrics.unused_column_count == 0


def test_unused_columns_unknown_for_leaf_models() -> None:
    leaf = _spec("leaf", ["id"])
    attach_unused_columns(_graph([leaf], []), [], [])
    assert not leaf.metrics.unused_columns_known


def test_shingles_ignore_case_whitespace_and_comments() -> None:
    a = shingles("select id,\n  amount from x -- note")
    b = shingles("SELECT id, amount   FROM x /* other */")
    assert a == b
    assert jaccard(a, b) == 1.0


def test_find_redundant_ranks_near_duplicates_first() -> None:
    sql = "select id, amount, currency from src where status = 'ok'"
    models = [
        ModelInput("a", frozenset({"src"}), frozenset({"id", "amount", "currency"}), sql),
        ModelInput("b", frozenset({"src"}), frozenset({"id", "amount", "currency"}), sql + " and x = 1"),
        ModelInput("c", frozenset({"src", "other"}), frozenset({"user_id", "name"}), "select user_id, name from other"),
        ModelInput("d", frozenset({"unrelated"}), frozenset({"id", "amount", "currency"}), sql),
    ]
    pairs = find_redundant(models, min_score=0.0)
    assert (pairs[0].a, pairs[0].b) == ("a", "b")
    assert pairs[0].score > 0.8
    assert pairs[0].shared_inputs == 1 and pairs[0].shared_columns == 3
    # d shares no input with anyone, so it's never a candidate.
    assert all("d" not in (p.a, p.b) for p in pairs)
    # Deterministic: same input, same output.
    assert pairs == find_redundant(models, min_score=0.0)


def test_find_redundant_drops_missing_signals_and_flags_direct_links() -> None:
    models = [
        ModelInput("a", frozenset({"src"}), frozenset(), None),
        ModelInput("b", frozenset({"src", "a"}), frozenset(), None),
    ]
    [pair] = find_redundant(models, min_score=0.0)
    assert pair.column_overlap is None and pair.sql_similarity is None
    assert pair.score == pair.input_overlap == 0.5  # only the inputs signal is left
    assert pair.direct_link

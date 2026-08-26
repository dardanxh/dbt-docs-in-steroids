"""build_graph keeps snapshots (a distinct dbt resource_type) alongside
models/seeds, and carries each node's materialization for color-by."""

from __future__ import annotations

from app.core.enums import ResourceType
from app.domain.ingestion.artifacts import ArtifactBundle
from app.domain.ingestion.graph_builder import build_graph


def _node(rtype: str, name: str, materialized: str | None) -> dict:
    return {
        "resource_type": rtype,
        "name": name,
        "database": "db",
        "schema": "sch",
        "alias": name,
        "config": {"materialized": materialized} if materialized else {},
        "original_file_path": f"{'snapshots' if rtype == 'snapshot' else 'models/dwh'}/{name}.sql",
        "fqn": ["proj", "dwh", name],
        "columns": {},
        "depends_on": {"nodes": []},
    }


def _manifest() -> dict:
    return {
        "metadata": {"dbt_version": "1.9.0", "adapter_type": "postgres"},
        "nodes": {
            "model.proj.inc": _node("model", "inc", "incremental"),
            "model.proj.tbl": _node("model", "tbl", "table"),
            "snapshot.proj.snap": _node("snapshot", "snap", None),
            "test.proj.some_test": _node("test", "some_test", None),  # must be skipped
        },
        "sources": {},
    }


def test_snapshot_is_kept_as_a_node() -> None:
    graph = build_graph(ArtifactBundle(manifest=_manifest()))
    snap = graph.nodes.get("snapshot.proj.snap")
    assert snap is not None
    assert snap.resource_type == ResourceType.SNAPSHOT


def test_tests_are_still_skipped_but_models_and_materializations_kept() -> None:
    graph = build_graph(ArtifactBundle(manifest=_manifest()))
    assert "test.proj.some_test" not in graph.nodes
    assert graph.nodes["model.proj.inc"].materialized == "incremental"
    assert graph.nodes["model.proj.tbl"].materialized == "table"

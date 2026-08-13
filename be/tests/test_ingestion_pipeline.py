"""End-to-end pipeline tests against a real dbt project.

Point ``DEFAULT_DBT_PROJECT_PATH`` at a dbt project whose ``target/`` holds a
manifest.json (+ catalog.json). Skipped when no manifest is available, so CI
without a project still passes.
"""

import os

import pytest

from app.core.enums import ResourceType
from app.domain.ingestion.artifacts import load_from_path
from app.domain.ingestion.column_lineage import build_column_edges
from app.domain.ingestion.graph_builder import build_graph

PROJECT_PATH = os.environ.get("DEFAULT_DBT_PROJECT_PATH", "./sample-dbt-project")
_has_manifest = os.path.isfile(os.path.join(PROJECT_PATH, "target", "manifest.json"))
pytestmark = pytest.mark.skipif(not _has_manifest, reason="no dbt manifest available")


@pytest.fixture(scope="module")
def graph():
    return build_graph(load_from_path(PROJECT_PATH))


def test_graph_has_models_and_edges(graph):
    models = [n for n in graph.nodes.values() if n.resource_type == ResourceType.MODEL]
    assert len(models) > 0
    assert len(graph.edges) > 0


def test_layers_are_derived(graph):
    layers = {n.layer.value for n in graph.nodes.values()}
    # every node gets a layer; models land in a known layer or "other"
    assert layers.issubset(
        {"source", "stage", "dwh", "datamart", "reporting", "lkp", "archive", "other"}
    )
    assert len(layers) > 1


def test_hotspot_metrics_populated(graph):
    top = max(graph.nodes.values(), key=lambda n: n.metrics.downstream_count)
    assert top.metrics.downstream_count > 0
    assert 0.0 <= top.metrics.hotspot_score <= 1.0


def test_code_metrics_populated(graph):
    from app.core.enums import ResourceType

    models = [n for n in graph.nodes.values() if n.resource_type == ResourceType.MODEL]
    assert any(m.metrics.loc > 0 for m in models)
    assert all(0.0 <= m.metrics.cohesion <= 1.0 for m in models)
    assert all(m.metrics.column_count == len(m.columns) for m in graph.nodes.values())
    # tests link to models via depends_on, so at least some models have a test_count
    assert sum(m.metrics.test_count for m in models) > 0


def test_column_lineage_produces_edges(graph):
    edges, diagnostics = build_column_edges(graph)
    assert len(diagnostics) > 0  # one per model
    ids = set(graph.nodes)
    for e in edges[:200]:
        assert e.src_node in ids and e.dst_node in ids

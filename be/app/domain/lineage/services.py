from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.enums import Confidence, Layer
from app.core.exceptions import NotFoundError
from app.domain.lineage.models import ColumnEdge, Node
from app.domain.lineage.repositories import LineageReadRepository
from app.domain.lineage.schemas import (
    ColumnEdgeOut,
    ColumnLineageResponse,
    ColumnLite,
    ColumnOut,
    ColumnRefOut,
    ColumnUsageItem,
    ColumnUsageOut,
    EdgeOut,
    GraphNodeOut,
    GraphResponse,
    LayerEdgeOut,
    LayerOut,
    MetricValueOut,
    NodeDetailOut,
    NodeMetricsOut,
)

# Canonical left-to-right ordering of layers in the graph (sources feed models
# feed marts feed reporting).
LAYER_ORDER = [
    Layer.SOURCE,
    Layer.STAGE,
    Layer.DWH,
    Layer.DATAMART,
    Layer.REPORTING,
    Layer.LKP,
    Layer.ARCHIVE,
    Layer.OTHER,
]

_METRIC_FIELDS = {
    "downstream_count",
    "upstream_count",
    "fan_in",
    "fan_out",
    "degree_centrality",
    "betweenness",
    "hotspot_score",
    "loc",
    "complexity",
    "cohesion",
    "test_count",
    "column_count",
}


class LineageService:
    def __init__(self, session: Session):
        self.session = session
        self.repo = LineageReadRepository(session)

    def _metrics(self, node: Node) -> NodeMetricsOut:
        return NodeMetricsOut(
            fan_in=node.fan_in,
            fan_out=node.fan_out,
            upstream_count=node.upstream_count,
            downstream_count=node.downstream_count,
            degree_centrality=node.degree_centrality,
            betweenness=node.betweenness,
            hotspot_score=node.hotspot_score,
            loc=node.loc,
            complexity=node.complexity,
            cohesion=node.cohesion,
            test_count=node.test_count,
            column_count=node.column_count,
        )

    def graph(self, project_id: str) -> GraphResponse:
        nodes = self.repo.nodes(project_id)
        if not nodes:
            raise NotFoundError(f"No ingested graph for project {project_id}")
        edges = self.repo.edges(project_id)
        layer_of = {n.unique_id: n.layer for n in nodes}

        node_outs = [
            GraphNodeOut(
                id=n.unique_id,
                name=n.name,
                resource_type=n.resource_type,
                layer=n.layer,
                materialized=n.materialized,
                column_lineage_status=n.column_lineage_status,
                metrics=self._metrics(n),
            )
            for n in nodes
        ]
        edge_outs = [EdgeOut(src=e.src_id, dst=e.dst_id) for e in edges]

        # Layers, in canonical order, only those present.
        by_layer: dict[str, list[str]] = defaultdict(list)
        for n in nodes:
            by_layer[n.layer].append(n.unique_id)
        layers = [
            LayerOut(id=f"layer:{layer.value}", name=layer.value, node_ids=by_layer[layer.value])
            for layer in LAYER_ORDER
            if by_layer.get(layer.value)
        ]

        # Aggregated cross-layer edges for the collapsed view.
        layer_edge_counts: dict[tuple[str, str], int] = defaultdict(int)
        for e in edges:
            src_layer = layer_of.get(e.src_id)
            dst_layer = layer_of.get(e.dst_id)
            if src_layer and dst_layer and src_layer != dst_layer:
                layer_edge_counts[(src_layer, dst_layer)] += 1
        layer_edges = [
            LayerEdgeOut(src=f"layer:{s}", dst=f"layer:{d}", count=c) for (s, d), c in sorted(layer_edge_counts.items())
        ]

        return GraphResponse(
            layers=layers,
            nodes=node_outs,
            edges=edge_outs,
            layer_edges=layer_edges,
            coverage=self._coverage(nodes),
        )

    @staticmethod
    def _coverage(nodes: list[Node]) -> dict[str, int]:
        models = [n for n in nodes if n.resource_type == "model"]
        ok = sum(1 for n in models if n.column_lineage_status == "ok")
        partial = sum(1 for n in models if n.column_lineage_status == "partial")
        failed = sum(1 for n in models if n.column_lineage_status == "failed")
        return {
            "nodes": len(nodes),
            "models": len(models),
            "column_lineage_ok": ok,
            "column_lineage_partial": partial,
            "column_lineage_failed": failed,
        }

    def node_detail(self, project_id: str, unique_id: str) -> NodeDetailOut:
        node = self.repo.node(project_id, unique_id)
        if not node:
            raise NotFoundError(f"Node {unique_id} not found")
        edges = self.repo.edges(project_id)
        parents = [e.src_id for e in edges if e.dst_id == unique_id]
        children = [e.dst_id for e in edges if e.src_id == unique_id]
        columns = [
            ColumnOut(
                name=c.name,
                data_type=c.data_type,
                description=c.description,
                tags=list(c.tags or []),
                has_lineage=bool(c.has_lineage),
            )
            for c in self.repo.columns(project_id, unique_id)
        ]
        return NodeDetailOut(
            id=node.unique_id,
            name=node.name,
            resource_type=node.resource_type,
            layer=node.layer,
            materialized=node.materialized,
            schema_name=node.schema_name,
            database_name=node.database_name,
            file_path=node.file_path,
            description=node.description,
            tags=list(node.tags or []),
            metrics=self._metrics(node),
            columns=columns,
            parents=parents,
            children=children,
            column_lineage_status=node.column_lineage_status,
            sql=node.raw_code,
        )

    def column_usage(self, project_id: str, unique_id: str) -> ColumnUsageOut:
        """For each direct neighbour, how many of the shared source's columns are
        consumed across the edge (used/total). See ColumnUsageOut."""
        node = self.repo.node(project_id, unique_id)
        if not node:
            raise NotFoundError(f"Node {unique_id} not found")

        totals = {n.unique_id: n.column_count for n in self.repo.nodes(project_id)}
        col_edges = self.repo.column_edges(project_id)

        # distinct src columns per (src_node, dst_node)
        used: dict[tuple[str, str], set[str]] = defaultdict(set)
        for e in col_edges:
            used[(e.src_node, e.dst_node)].add(e.src_col)

        edges = self.repo.edges(project_id)
        upstream = [
            ColumnUsageItem(
                node_id=e.src_id,
                used=len(used.get((e.src_id, unique_id), set())),
                total=totals.get(e.src_id, 0),
            )
            for e in edges
            if e.dst_id == unique_id
        ]
        downstream = [
            ColumnUsageItem(
                node_id=e.dst_id,
                used=len(used.get((unique_id, e.dst_id), set())),
                total=totals.get(unique_id, 0),
            )
            for e in edges
            if e.src_id == unique_id
        ]
        return ColumnUsageOut(upstream=upstream, downstream=downstream)

    def node_columns(self, project_id: str, unique_id: str) -> list[ColumnLite]:
        if not self.repo.node(project_id, unique_id):
            raise NotFoundError(f"Node {unique_id} not found")
        return [
            ColumnLite(name=c.name, data_type=c.data_type, has_lineage=bool(c.has_lineage))
            for c in self.repo.columns(project_id, unique_id)
        ]

    def metrics(self, project_id: str, metric: str) -> list[MetricValueOut]:
        if metric not in _METRIC_FIELDS:
            metric = "downstream_count"
        nodes = self.repo.nodes(project_id)
        values = {n.unique_id: float(getattr(n, metric)) for n in nodes}
        hi = max(values.values(), default=0.0)
        return [MetricValueOut(node_id=uid, value=v, normalized=(v / hi if hi else 0.0)) for uid, v in values.items()]

    def column_lineage(self, project_id: str, unique_id: str, column: str, direction: str) -> ColumnLineageResponse:
        if not self.repo.node(project_id, unique_id):
            raise NotFoundError(f"Node {unique_id} not found")
        col = column.lower()
        nodes = self.repo.nodes(project_id)
        layer_of = {n.unique_id: n.layer for n in nodes}
        col_edges = self.repo.column_edges(project_id)

        upstream_adj: dict[tuple[str, str], list[ColumnEdge]] = defaultdict(list)
        downstream_adj: dict[tuple[str, str], list[ColumnEdge]] = defaultdict(list)
        for e in col_edges:
            downstream_adj[(e.src_node, e.src_col)].append(e)
            upstream_adj[(e.dst_node, e.dst_col)].append(e)

        visited_cols: set[tuple[str, str]] = set()
        collected_edges: dict[int, ColumnEdge] = {}
        partial = False

        def walk(
            adj: dict[tuple[str, str], list[ColumnEdge]],
            next_of: Callable[[ColumnEdge], tuple[str, str]],
            start: tuple[str, str],
        ) -> None:
            nonlocal partial
            queue: deque[tuple[str, str]] = deque([start])
            seen: set[tuple[str, str]] = {start}
            while queue:
                current = queue.popleft()
                visited_cols.add(current)
                for edge in adj.get(current, []):
                    collected_edges[edge.id] = edge
                    if edge.confidence == Confidence.LOW:
                        partial = True
                    nxt = next_of(edge)
                    if nxt not in seen:
                        seen.add(nxt)
                        queue.append(nxt)

        if direction in ("upstream", "both"):
            walk(upstream_adj, lambda e: (e.src_node, e.src_col), (unique_id, col))
        if direction in ("downstream", "both"):
            walk(downstream_adj, lambda e: (e.dst_node, e.dst_col), (unique_id, col))

        def ref(node_id: str, c: str) -> ColumnRefOut:
            return ColumnRefOut(node_id=node_id, column=c, layer=layer_of.get(node_id, Layer.OTHER.value))

        edges_out = [
            ColumnEdgeOut(
                src=ref(e.src_node, e.src_col),
                dst=ref(e.dst_node, e.dst_col),
                transform=e.transform,
                confidence=e.confidence,
            )
            for e in collected_edges.values()
        ]
        source_columns = [
            ref(n, c) for (n, c) in visited_cols if layer_of.get(n) == Layer.SOURCE.value and (n, c) != (unique_id, col)
        ]
        return ColumnLineageResponse(
            root=ref(unique_id, col),
            direction=direction,
            columns=[ref(n, c) for (n, c) in visited_cols],
            edges=edges_out,
            source_columns=source_columns,
            partial=partial,
        )

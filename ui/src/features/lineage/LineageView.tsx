import { Background, BackgroundVariant, Controls, ReactFlow, type Node as RFNode } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hotspotColor } from "@/lib/colors";
import type { ColumnLineage, MetricKey } from "@/types";
import { useGraph } from "./api";
import { computeLayout } from "./layout";
import { NodePanel } from "./NodePanel";
import { CollapsedNode, HeaderNode, ModelNode } from "./nodes";

const NODE_TYPES = { model: ModelNode, header: HeaderNode, collapsed: CollapsedNode };

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "downstream_count", label: "Downstream users (hotspots)" },
  { key: "upstream_count", label: "Upstream depth" },
  { key: "fan_out", label: "Direct dependents" },
  { key: "fan_in", label: "Direct inputs" },
  { key: "betweenness", label: "Betweenness centrality" },
  { key: "hotspot_score", label: "Hotspot score" },
];

interface Trace {
  lineage: ColumnLineage;
  rootColumn: string;
}

export function LineageView({ projectId }: { projectId: string }) {
  const { data: graph, isPending, error } = useGraph(projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<MetricKey>("downstream_count");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);

  // On first load, collapse oversized layers (e.g. 200+ sources) so the swimlane
  // graph fits the viewport instead of stretching thousands of px tall.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph && initializedFor.current !== projectId) {
      initializedFor.current = projectId;
      setCollapsed(new Set(graph.layers.filter((l) => l.node_ids.length > 50).map((l) => l.name)));
    }
  }, [graph, projectId]);

  const highlight = useMemo(() => {
    if (!trace) return { nodes: undefined, edges: undefined };
    const nodes = new Set<string>(trace.lineage.columns.map((c) => c.node_id));
    const edges = new Set<string>(trace.lineage.edges.map((e) => `${e.src.node_id}->${e.dst.node_id}`));
    return { nodes, edges };
  }, [trace]);

  // A trace often reaches into a collapsed layer (e.g. sources). Expand any
  // layer that contains a highlighted node so the path is actually visible.
  const setTraceAndReveal = useCallback(
    (t: Trace | null) => {
      setTrace(t);
      if (t && graph) {
        const touched = new Set(t.lineage.columns.map((c) => c.layer));
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const layer of touched) next.delete(layer);
          return next;
        });
      }
    },
    [graph],
  );

  const layout = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return computeLayout(graph, {
      collapsed,
      metric,
      highlightNodes: highlight.nodes,
      activeEdges: highlight.edges,
    });
  }, [graph, collapsed, metric, highlight]);

  const toggleLayer = useCallback((layer: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(layer) ? next.delete(layer) : next.add(layer);
      return next;
    });
  }, []);

  const onNodeClick = useCallback(
    (_: unknown, node: RFNode) => {
      if (node.type === "header") {
        toggleLayer((node.data as { layer: string }).layer);
      } else if (node.type === "collapsed") {
        toggleLayer((node.data as { layer: string }).layer);
      } else if (node.type === "model") {
        setSelectedNodeId(node.id);
        setTrace(null);
      }
    },
    [toggleLayer],
  );

  if (isPending) return <Centered>Loading graph…</Centered>;
  if (error) return <Centered>Failed to load graph. Is the project ingested?</Centered>;
  if (!graph) return null;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1b2740" />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Toolbar
        metric={metric}
        onMetric={setMetric}
        coverage={graph.coverage}
        collapsedCount={collapsed.size}
        onExpandAll={() => setCollapsed(new Set())}
        onCollapseAll={() => setCollapsed(new Set(graph.layers.map((l) => l.name)))}
      />

      {trace && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-panel/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
          Tracing <span className="font-semibold text-accent">{trace.rootColumn}</span> ·{" "}
          {trace.lineage.source_columns.length} source column(s) ·{" "}
          {trace.lineage.partial && <span className="text-amber-400">partial </span>}
          <button type="button" className="ml-2 text-muted underline" onClick={() => setTrace(null)}>
            clear
          </button>
        </div>
      )}

      {selectedNodeId && (
        <NodePanel
          projectId={projectId}
          nodeId={selectedNodeId}
          onClose={() => {
            setSelectedNodeId(null);
            setTrace(null);
          }}
          onTrace={(lineage, rootColumn) => setTraceAndReveal({ lineage, rootColumn })}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
            setTrace(null);
          }}
        />
      )}
    </div>
  );
}

function Toolbar({
  metric,
  onMetric,
  coverage,
  collapsedCount,
  onExpandAll,
  onCollapseAll,
}: {
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  coverage: Record<string, number>;
  collapsedCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 rounded-lg border border-border bg-panel/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-muted">Color by</span>
        <select
          value={metric}
          onChange={(e) => onMetric(e.target.value as MetricKey)}
          className="rounded border border-border bg-panel-2 px-2 py-1 text-fg outline-none"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <Legend />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCollapseAll}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={onExpandAll}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg"
        >
          Expand all
        </button>
        {collapsedCount > 0 && <span className="text-muted">{collapsedCount} collapsed</span>}
      </div>
      <div className="text-[11px] text-muted">
        Column lineage: <span className="text-emerald-400">{coverage.column_lineage_ok ?? 0} ok</span> ·{" "}
        <span className="text-amber-400">{coverage.column_lineage_partial ?? 0} partial</span> ·{" "}
        {coverage.column_lineage_failed ?? 0} none / {coverage.models ?? 0} models
      </div>
    </div>
  );
}

function Legend() {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">low</span>
      <div className="flex h-3 w-32 overflow-hidden rounded">
        {stops.map((s) => (
          <div key={s} className="h-full flex-1" style={{ background: hotspotColor(s) }} />
        ))}
      </div>
      <span className="text-muted">high</span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-muted">{children}</div>;
}

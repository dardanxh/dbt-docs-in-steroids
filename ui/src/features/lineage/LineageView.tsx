import { Background, BackgroundVariant, Controls, ReactFlow, type Node as RFNode } from "@xyflow/react";
import { Crosshair, PanelRight, Scan } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hotspotColor, layerColor } from "@/lib/colors";
import { useThemeTokens } from "@/lib/settings";
import { cn } from "@/lib/utils";
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
  const tokens = useThemeTokens();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<MetricKey>("downstream_count");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string; name: string } | null>(null);
  const [layerOrder, setLayerOrder] = useState<string[] | null>(null);

  // On first load, collapse oversized layers (e.g. 200+ sources) so the swimlane
  // graph fits the viewport instead of stretching thousands of px tall.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph && initializedFor.current !== projectId) {
      initializedFor.current = projectId;
      setCollapsed(new Set(graph.layers.filter((l) => l.node_ids.length > 50).map((l) => l.name)));
      setLayerOrder(graph.layers.map((l) => l.name));
    }
  }, [graph, projectId]);

  // Node adjacency (direct parents/children) from the edge list — reused by the
  // selection highlight and by focus mode.
  const adjacency = useMemo(() => {
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const arr = m.get(k);
      if (arr) arr.push(v);
      else m.set(k, [v]);
    };
    if (graph) {
      for (const e of graph.edges) {
        push(parents, e.dst, e.src);
        push(children, e.src, e.dst);
      }
    }
    return { parents, children };
  }, [graph]);

  // Clicking a model highlights it + its direct inputs/dependents (one hop) and
  // the arrows in/out of it; everything else dims.
  const selectionHighlight = useMemo(() => {
    if (!selectedNodeId) return null;
    const nodes = new Set<string>([selectedNodeId]);
    const edges = new Set<string>();
    for (const p of adjacency.parents.get(selectedNodeId) ?? []) {
      nodes.add(p);
      edges.add(`${p}->${selectedNodeId}`);
    }
    for (const c of adjacency.children.get(selectedNodeId) ?? []) {
      nodes.add(c);
      edges.add(`${selectedNodeId}->${c}`);
    }
    return { nodes, edges };
  }, [selectedNodeId, adjacency]);

  // A column trace (if active) takes priority over the node-neighbor highlight.
  const highlight = useMemo(() => {
    if (trace) {
      return {
        nodes: new Set<string>(trace.lineage.columns.map((c) => c.node_id)),
        edges: new Set<string>(trace.lineage.edges.map((e) => `${e.src.node_id}->${e.dst.node_id}`)),
      };
    }
    if (selectionHighlight) return selectionHighlight;
    return { nodes: undefined, edges: undefined };
  }, [trace, selectionHighlight]);

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

  // Focus mode: the focused model + all its transitive ancestors and descendants.
  // Everything else is hidden (see computeLayout's focusIds filter).
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    const walk = (adj: Map<string, string[]>) => {
      const queue = [focusId];
      while (queue.length) {
        const cur = queue.shift();
        if (cur === undefined) break;
        for (const next of adj.get(cur) ?? []) {
          if (!set.has(next)) {
            set.add(next);
            queue.push(next);
          }
        }
      }
    };
    walk(adjacency.parents);
    walk(adjacency.children);
    return set;
  }, [focusId, adjacency]);

  const focusName = focusId ? (graph?.nodes.find((n) => n.id === focusId)?.name ?? focusId) : null;

  const layout = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return computeLayout(graph, {
      collapsed: focusId ? new Set<string>() : collapsed,
      metric,
      highlightNodes: highlight.nodes,
      activeEdges: highlight.edges,
      focusIds: focusSet,
      layerOrder: layerOrder ?? undefined,
    });
  }, [graph, collapsed, metric, highlight, focusId, focusSet, layerOrder]);

  const reorderLayers = useCallback(
    (from: number, to: number) => {
      setLayerOrder((prev) => {
        const base = prev ?? graph?.layers.map((l) => l.name) ?? [];
        if (from < 0 || from >= base.length || to < 0 || to >= base.length) return base;
        const next = [...base];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [graph],
  );

  const toggleLayer = useCallback((layer: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(layer) ? next.delete(layer) : next.add(layer);
      return next;
    });
  }, []);

  const onNodeClick = useCallback(
    (_: unknown, node: RFNode) => {
      setMenu(null);
      if (node.type === "header" || node.type === "collapsed") {
        toggleLayer((node.data as { layer: string }).layer);
      } else if (node.type === "model") {
        setSelectedNodeId(node.id);
        setTrace(null);
      }
    },
    [toggleLayer],
  );

  // Right-click a model → context menu (focus / view columns).
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: RFNode) => {
    if (node.type !== "model") return;
    event.preventDefault();
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 210),
      y: Math.min(event.clientY, window.innerHeight - 130),
      nodeId: node.id,
      name: (node.data as { label: string }).label,
    });
  }, []);

  if (isPending) return <Centered>Loading graph…</Centered>;
  if (error) return <Centered>Failed to load graph. Is the project ingested?</Centered>;
  if (!graph) return null;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        key={focusId ?? "all"}
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={tokens.border} />
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

      <LayerOrderBar
        order={layerOrder ?? graph.layers.map((l) => l.name)}
        onReorder={reorderLayers}
        onReset={() => setLayerOrder(graph.layers.map((l) => l.name))}
        canReset={!!layerOrder && layerOrder.join() !== graph.layers.map((l) => l.name).join()}
      />

      <div className="-translate-x-1/2 absolute top-4 left-1/2 z-10 flex flex-col items-center gap-2">
        {focusId && (
          <div className="rounded-md border border-sky-500/40 bg-panel/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            Focused on <span className="font-semibold text-sky-400">{focusName}</span> ·{" "}
            {(focusSet?.size ?? 1) - 1} related node(s) ·{" "}
            <button type="button" className="ml-1 text-muted underline" onClick={() => setFocusId(null)}>
              show all
            </button>
          </div>
        )}
        {trace && (
          <div className="rounded-md border border-border bg-panel/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            Tracing <span className="font-semibold text-accent">{trace.rootColumn}</span> ·{" "}
            {trace.lineage.source_columns.length} source column(s) ·{" "}
            {trace.lineage.partial && <span className="text-amber-400">partial </span>}
            <button type="button" className="ml-2 text-muted underline" onClick={() => setTrace(null)}>
              clear
            </button>
          </div>
        )}
      </div>

      {menu && (
        <>
          {/* click-away catcher */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-40 min-w-[200px] overflow-hidden rounded-md border border-border bg-panel py-1 text-xs shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="truncate border-border border-b px-3 py-1.5 font-medium text-muted">
              {menu.name}
            </div>
            <MenuItem
              icon={<PanelRight size={13} />}
              label="View columns & details"
              onClick={() => {
                setSelectedNodeId(menu.nodeId);
                setTrace(null);
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<Crosshair size={13} />}
              label={focusId === menu.nodeId ? "Re-focus lineage" : "Focus lineage"}
              onClick={() => {
                setTrace(null);
                setFocusId(menu.nodeId);
                setMenu(null);
              }}
            />
            {focusId && (
              <MenuItem
                icon={<Scan size={13} />}
                label="Show all (exit focus)"
                onClick={() => {
                  setFocusId(null);
                  setMenu(null);
                }}
              />
            )}
          </div>
        </>
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
          onFocus={(id) => {
            setTrace(null);
            setFocusId(id);
          }}
          isFocused={focusId === selectedNodeId}
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

function LayerOrderBar({
  order,
  onReorder,
  onReset,
  canReset,
}: {
  order: string[];
  onReorder: (from: number, to: number) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  return (
    <div className="-translate-x-1/2 absolute bottom-4 left-1/2 z-10 flex items-center gap-2 rounded-lg border border-border bg-panel/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <span className="text-muted">Layer order</span>
      <span className="text-[10px] text-muted/60">(drag to reorder)</span>
      <div className="flex items-center gap-1">
        {order.map((name, i) => (
          <button
            key={name}
            type="button"
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={cn(
              "flex cursor-grab items-center gap-1.5 rounded border px-2 py-1 active:cursor-grabbing",
              overIndex === i && dragIndex !== null && dragIndex !== i
                ? "border-accent bg-panel-2"
                : "border-border",
              dragIndex === i && "opacity-40",
            )}
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: layerColor(name) }} />
            <span className="text-fg">{name}</span>
          </button>
        ))}
      </div>
      {canReset && (
        <button type="button" onClick={onReset} className="ml-1 text-muted underline">
          reset
        </button>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-panel-2"
    >
      {icon}
      {label}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-muted">{children}</div>;
}

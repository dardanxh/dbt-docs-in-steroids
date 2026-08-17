import { Background, BackgroundVariant, Controls, ReactFlow, type Node as RFNode } from "@xyflow/react";
import { Crosshair, Layers, PanelRight, Scan, Search, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSidebarSlot } from "@/features/app-shell/sidebar-slot";
import { hotspotColor, layerColor, STATUS_LEGEND } from "@/lib/colors";
import { useSettings, useThemeTokens } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { ColumnLineage, MetricKey, NodeMetrics } from "@/types";
import { useColumnUsage, useGraph } from "./api";
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
  { key: "degree_centrality", label: "Degree centrality" },
  { key: "hotspot_score", label: "Hotspot score" },
  { key: "complexity", label: "SQL complexity" },
  { key: "loc", label: "Lines of code" },
  { key: "test_count", label: "Test count" },
  { key: "cohesion", label: "Cohesion" },
  { key: "column_count", label: "Column count" },
];

// Categorical colorings (discrete palette + legend) live alongside the numeric
// heat metrics in the same "Color by" dropdown.
const STATUS_COLOR_KEY = "column_lineage_status";
type ColorKey = MetricKey | typeof STATUS_COLOR_KEY;

// Fractional metrics get fixed decimals; counts stay whole numbers.
const DECIMALS: Partial<Record<keyof NodeMetrics, number>> = {
  cohesion: 2,
  hotspot_score: 3,
  betweenness: 3,
  degree_centrality: 3,
};

function formatBadge(key: keyof NodeMetrics, v: number): string {
  const dp = DECIMALS[key];
  if (dp != null) return v.toFixed(dp);
  if (key === "complexity") return String(Math.round(v));
  return String(v);
}

interface Trace {
  lineage: ColumnLineage;
  rootColumn: string;
}

interface FocusTab {
  key: string; // "all" or the focused node id
  focusId: string | null; // null for the All tab
  label: string;
}

const ALL_TAB: FocusTab = { key: "all", focusId: null, label: "All" };

type FocusDirection = "up" | "down" | "both";

export function LineageView({ projectId, focusNodeId }: { projectId: string; focusNodeId?: string | null }) {
  const { data: graph, isPending, error } = useGraph(projectId);
  const tokens = useThemeTokens();
  const { settings } = useSettings();
  const { target: sidebarSlot } = useSidebarSlot();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [colorBy, setColorBy] = useState<ColorKey>("downstream_count");
  const colorByStatus = colorBy === STATUS_COLOR_KEY;
  // Numeric metric backing ordering + badges; falls back to a sensible default
  // when a categorical coloring (e.g. status) is active.
  const metric: MetricKey = colorByStatus ? "downstream_count" : colorBy;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  // Focus tabs: "All" (never closeable) + one closeable tab per focused module,
  // each rendering only that module's lineage subgraph.
  const [tabs, setTabs] = useState<FocusTab[]>([ALL_TAB]);
  const [activeKey, setActiveKey] = useState("all");
  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const focusId = activeTab.focusId;
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string; name: string } | null>(null);

  const openFocus = useCallback((nodeId: string, label: string) => {
    setTabs((prev) =>
      prev.some((t) => t.key === nodeId) ? prev : [...prev, { key: nodeId, focusId: nodeId, label }],
    );
    setActiveKey(nodeId);
    setTrace(null);
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key));
    setActiveKey((cur) => (cur === key ? "all" : cur));
  }, []);
  const [layerOrder, setLayerOrder] = useState<string[] | null>(null);
  // Layout refinements: `tidy` reorders nodes within columns to reduce edge
  // crossings; `flatten` ignores semantic layers and columns by dependency depth.
  const [tidy, setTidy] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [search, setSearch] = useState("");
  const [testFilter, setTestFilter] = useState<"all" | "untested" | "tested">("all");
  // Focus-tab depth control: how many hops of parents/children to include, and
  // in which direction. null depth = the whole lineage.
  const [focusDepth, setFocusDepth] = useState<number | null>(null);
  const [focusDirection, setFocusDirection] = useState<FocusDirection>("both");

  // On first load, collapse oversized layers (e.g. 200+ sources) so the swimlane
  // graph fits the viewport instead of stretching thousands of px tall.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph && initializedFor.current !== projectId) {
      initializedFor.current = projectId;
      setCollapsed(new Set(graph.layers.filter((l) => l.node_ids.length > 50).map((l) => l.name)));
      setLayerOrder(graph.layers.map((l) => l.name));
      setTabs([ALL_TAB]);
      setActiveKey("all");
    }
  }, [graph, projectId]);

  // Externally-driven selection (from the Cmd-K palette or the Quality view):
  // select the node and reveal its (possibly collapsed) layer.
  useEffect(() => {
    if (!focusNodeId || !graph) return;
    const node = graph.nodes.find((n) => n.id === focusNodeId);
    if (!node) return;
    setSelectedNodeId(focusNodeId);
    setTrace(null);
    setCollapsed((prev) => {
      if (!prev.has(node.layer)) return prev;
      const next = new Set(prev);
      next.delete(node.layer);
      return next;
    });
  }, [focusNodeId, graph]);

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

  // Search / filter: matched node set (name substring + test filter). Null when
  // no filter is active.
  const filterActive = search.trim() !== "" || testFilter !== "all";
  const filterMatch = useMemo(() => {
    if (!graph || !filterActive) return null;
    const q = search.trim().toLowerCase();
    const matched = new Set<string>();
    for (const n of graph.nodes) {
      if (q && !n.name.toLowerCase().includes(q)) continue;
      if (testFilter === "untested" && !(n.resource_type === "model" && n.metrics.test_count === 0)) continue;
      if (testFilter === "tested" && !(n.metrics.test_count > 0)) continue;
      matched.add(n.id);
    }
    return matched;
  }, [graph, filterActive, search, testFilter]);

  // Highlight priority: column trace > node selection > search filter.
  const highlight = useMemo(() => {
    if (trace) {
      return {
        nodes: new Set<string>(trace.lineage.columns.map((c) => c.node_id)),
        edges: new Set<string>(trace.lineage.edges.map((e) => `${e.src.node_id}->${e.dst.node_id}`)),
      };
    }
    // In a focus tab everything shown is already the relevant subgraph. Selecting
    // a node highlights its in/out ARROWS but does NOT dim the other nodes (which
    // would make related nodes look unrelated).
    if (focusId) return { nodes: undefined, edges: selectionHighlight?.edges };
    if (selectionHighlight) return selectionHighlight;
    if (filterMatch) return { nodes: filterMatch, edges: new Set<string>() };
    return { nodes: undefined, edges: undefined };
  }, [trace, focusId, selectionHighlight, filterMatch]);

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

  // Focus mode: the focused model + its parents/children up to `focusDepth` hops
  // (null = unlimited) in the chosen direction. Everything else is hidden (see
  // computeLayout's focusIds filter).
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    const maxDepth = focusDepth ?? Number.POSITIVE_INFINITY;
    const bfs = (adj: Map<string, string[]>) => {
      let frontier = [focusId];
      let depth = 0;
      while (frontier.length && depth < maxDepth) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const nb of adj.get(cur) ?? []) {
            if (!set.has(nb)) {
              set.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
        depth++;
      }
    };
    if (focusDirection === "up" || focusDirection === "both") bfs(adjacency.parents);
    if (focusDirection === "down" || focusDirection === "both") bfs(adjacency.children);
    return set;
  }, [focusId, adjacency, focusDepth, focusDirection]);

  // Column-usage fractions for the selected node's neighbours.
  const { data: usage } = useColumnUsage(projectId, selectedNodeId);

  // Right-aligned node badges: the active "Color by" metric when nothing is
  // selected (so the number matches the coloring); the selected node shows its
  // column count and each neighbour shows used/total columns across the edge.
  // `badgeMetric: "none"` still acts as an off switch for the per-node number.
  const badges = useMemo(() => {
    const map = new Map<string, string>();
    if (!graph) return map;
    if (selectedNodeId) {
      const sel = graph.nodes.find((n) => n.id === selectedNodeId);
      if (sel) map.set(selectedNodeId, `${sel.metrics.column_count} cols`);
      if (settings.showColumnFractions && usage) {
        for (const u of [...usage.upstream, ...usage.downstream]) {
          map.set(u.node_id, u.total > 0 ? `${u.used}/${u.total}` : "–");
        }
      }
    } else if (!colorByStatus && settings.badgeMetric !== "none") {
      for (const n of graph.nodes) {
        const v = n.metrics[metric];
        if (v != null && v !== 0) map.set(n.id, formatBadge(metric, v));
      }
    }
    return map;
  }, [
    graph,
    selectedNodeId,
    usage,
    metric,
    colorByStatus,
    settings.badgeMetric,
    settings.showColumnFractions,
  ]);

  const layout = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return computeLayout(graph, {
      collapsed: focusId ? new Set<string>() : collapsed,
      metric,
      highlightNodes: highlight.nodes,
      activeEdges: highlight.edges,
      focusIds: focusSet,
      layerOrder: layerOrder ?? undefined,
      badges,
      tidy,
      flatten,
      colorByStatus,
    });
  }, [
    graph,
    collapsed,
    metric,
    highlight,
    focusId,
    focusSet,
    layerOrder,
    badges,
    tidy,
    flatten,
    colorByStatus,
  ]);

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
    <div className="flex h-full w-full flex-col">
      <TabBar tabs={tabs} activeKey={activeKey} onSelect={setActiveKey} onClose={closeTab} />
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          key={`${activeKey}:${focusDepth ?? "all"}:${focusDirection}:${flatten ? "flat" : "layers"}`}
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
          // Trackpad-native panning: two-finger scroll pans, pinch (or ⌘+scroll)
          // zooms. Click-drag on the pane still pans too.
          panOnScroll
          zoomOnScroll={false}
          panOnDrag
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={tokens.border} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {focusId && (
          <FocusDepthControl
            depth={focusDepth}
            onDepth={setFocusDepth}
            direction={focusDirection}
            onDirection={setFocusDirection}
            count={focusSet?.size ?? 1}
          />
        )}

        {/* Dock the controls into the right sidebar; when the sidebar is
            collapsed (no slot) we simply hide them rather than float a panel
            over the canvas. */}
        {sidebarSlot &&
          createPortal(
            <Toolbar
              colorBy={colorBy}
              onColorBy={setColorBy}
              coverage={graph.coverage}
              collapsedCount={collapsed.size}
              onExpandAll={() => setCollapsed(new Set())}
              onCollapseAll={() => setCollapsed(new Set(graph.layers.map((l) => l.name)))}
              tidy={tidy}
              onTidy={() => setTidy((v) => !v)}
              flatten={flatten}
              onFlatten={() => setFlatten((v) => !v)}
            />,
            sidebarSlot,
          )}

        {/* Manual column order only applies to semantic layers, not flattened
            depth stages. */}
        {!flatten && (
          <LayerOrderBar
            order={layerOrder ?? graph.layers.map((l) => l.name)}
            onReorder={reorderLayers}
            onReset={() => setLayerOrder(graph.layers.map((l) => l.name))}
            canReset={!!layerOrder && layerOrder.join() !== graph.layers.map((l) => l.name).join()}
          />
        )}

        <div className="-translate-x-1/2 absolute top-4 left-1/2 z-10 flex flex-col items-center gap-2">
          <SearchBar
            search={search}
            onSearch={setSearch}
            testFilter={testFilter}
            onTestFilter={setTestFilter}
            matchCount={filterMatch?.size ?? null}
          />
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
                label={tabs.some((t) => t.key === menu.nodeId) ? "Go to focus tab" : "Focus in new tab"}
                onClick={() => {
                  openFocus(menu.nodeId, menu.name);
                  setMenu(null);
                }}
              />
              {focusId && (
                <MenuItem
                  icon={<Scan size={13} />}
                  label="Back to All tab"
                  onClick={() => {
                    setActiveKey("all");
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
              const n = graph.nodes.find((x) => x.id === id);
              openFocus(id, n?.name ?? id);
            }}
            isFocused={focusId === selectedNodeId}
          />
        )}
      </div>
    </div>
  );
}

function FocusDepthControl({
  depth,
  onDepth,
  direction,
  onDirection,
  count,
}: {
  depth: number | null;
  onDepth: (d: number | null) => void;
  direction: FocusDirection;
  onDirection: (d: FocusDirection) => void;
  count: number;
}) {
  const seg = "px-1.5 py-0.5 text-[11px]";
  const on = "bg-panel-2 text-fg";
  const off = "text-muted hover:text-fg";
  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-md border border-border bg-panel/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur">
      <span className="text-muted">Show</span>
      <div className="flex overflow-hidden rounded border border-border">
        {(["up", "both", "down"] as FocusDirection[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDirection(d)}
            className={cn(seg, direction === d ? on : off)}
          >
            {d === "up" ? "↑ upstream" : d === "down" ? "downstream ↓" : "both"}
          </button>
        ))}
      </div>
      <span className="text-muted">hops</span>
      <div className="flex overflow-hidden rounded border border-border">
        {[1, 2, 3, null].map((d) => (
          <button
            key={d ?? "all"}
            type="button"
            onClick={() => onDepth(d)}
            className={cn(seg, depth === d ? on : off)}
          >
            {d ?? "all"}
          </button>
        ))}
      </div>
      <span className="text-muted">· {count - 1} related</span>
    </div>
  );
}

function TabBar({
  tabs,
  activeKey,
  onSelect,
  onClose,
}: {
  tabs: FocusTab[];
  activeKey: string;
  onSelect: (k: string) => void;
  onClose: (k: string) => void;
}) {
  if (tabs.length <= 1) return null; // only the All tab — no bar needed
  return (
    <div className="flex items-center gap-1 border-border border-b bg-panel px-2 py-1 text-xs">
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <div
            key={t.key}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1",
              active ? "bg-panel-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(t.key)}
              className="flex max-w-[180px] items-center gap-1 truncate"
            >
              {t.key !== "all" && <Crosshair size={11} className="shrink-0" />}
              <span className="truncate">{t.label}</span>
            </button>
            {t.key !== "all" && (
              <button
                type="button"
                onClick={() => onClose(t.key)}
                title="Close tab"
                className="text-muted hover:text-fg"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SearchBar({
  search,
  onSearch,
  testFilter,
  onTestFilter,
  matchCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  testFilter: "all" | "untested" | "tested";
  onTestFilter: (v: "all" | "untested" | "tested") => void;
  matchCount: number | null;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-panel/95 px-2 py-1 text-xs shadow-lg backdrop-blur">
      <Search size={13} className="text-muted" />
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search models…"
        className="w-44 bg-transparent text-fg outline-none placeholder:text-muted"
      />
      <div className="flex overflow-hidden rounded border border-border">
        {(["all", "tested", "untested"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onTestFilter(f)}
            className={cn(
              "px-1.5 py-0.5 text-[10px]",
              testFilter === f ? "bg-panel-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      {matchCount !== null && <span className="text-muted">{matchCount} match</span>}
      {(search || testFilter !== "all") && (
        <button
          type="button"
          onClick={() => {
            onSearch("");
            onTestFilter("all");
          }}
          className="text-muted hover:text-fg"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Toolbar({
  colorBy,
  onColorBy,
  coverage,
  collapsedCount,
  onExpandAll,
  onCollapseAll,
  tidy,
  onTidy,
  flatten,
  onFlatten,
}: {
  colorBy: ColorKey;
  onColorBy: (m: ColorKey) => void;
  coverage: Record<string, number>;
  collapsedCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  tidy: boolean;
  onTidy: () => void;
  flatten: boolean;
  onFlatten: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-border border-t px-3 py-3 text-xs">
      <div className="font-medium text-[10px] text-muted uppercase tracking-wide">Graph controls</div>
      <div className="flex flex-col gap-1">
        <span className="text-muted">Color by</span>
        <select
          value={colorBy}
          onChange={(e) => onColorBy(e.target.value as ColorKey)}
          className="w-full rounded border border-border bg-panel-2 px-2 py-1 text-fg outline-none"
        >
          <optgroup label="Metrics (heat)">
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Categories">
            <option value={STATUS_COLOR_KEY}>Column lineage status</option>
          </optgroup>
        </select>
      </div>
      <Legend status={colorBy === STATUS_COLOR_KEY} />
      <div className="flex flex-col gap-1">
        <span className="text-muted">Layout</span>
        <div className="flex items-center gap-2">
          <ToggleButton
            active={tidy}
            onClick={onTidy}
            title="Reorder nodes within each column to reduce edge crossings"
          >
            <Wand2 size={12} /> Untangle
          </ToggleButton>
          <ToggleButton
            active={flatten}
            onClick={onFlatten}
            title="Ignore SOURCE/DWH/DATAMART layers; lay out columns by dependency depth"
          >
            <Layers size={12} /> Skip layers
          </ToggleButton>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCollapseAll}
          disabled={flatten}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={onExpandAll}
          disabled={flatten}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
        >
          Expand all
        </button>
        {!flatten && collapsedCount > 0 && <span className="text-muted">{collapsedCount} collapsed</span>}
      </div>
      <div className="text-[11px] text-muted">
        Column lineage: <span className="text-emerald-400">{coverage.column_lineage_ok ?? 0} ok</span> ·{" "}
        <span className="text-amber-400">{coverage.column_lineage_partial ?? 0} partial</span> ·{" "}
        {coverage.column_lineage_failed ?? 0} none / {coverage.models ?? 0} models
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded border px-2 py-1",
        active ? "border-accent bg-accent/15 text-fg" : "border-border text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Legend({ status }: { status: boolean }) {
  if (status) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {STATUS_LEGEND.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    );
  }
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

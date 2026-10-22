import { Background, BackgroundVariant, Controls, ReactFlow, type Node as RFNode } from "@xyflow/react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRightFromLine,
  ArrowRightToLine,
  ArrowUp,
  BookOpen,
  CalendarClock,
  CircleOff,
  Columns3,
  Crosshair,
  Database,
  EyeOff,
  FileCode,
  Flame,
  FlaskConical,
  GitCommitHorizontal,
  GripVertical,
  Layers,
  ListTree,
  type LucideIcon,
  Milestone,
  Network,
  PanelRight,
  Puzzle,
  RotateCcw,
  Route,
  Scan,
  Search,
  Shapes,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TriangleAlert,
  UserRound,
  Users,
  Waypoints,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSidebarSlot } from "@/features/app-shell/sidebar-slot";
import {
  errorColor,
  hotspotColor,
  layerColor,
  MATERIALIZATION_LEGEND,
  materializationCategory,
  materializationColor,
  ownerColor,
  riskScore,
  STATUS_LEGEND,
} from "@/lib/colors";
import { useSettings, useThemeTokens } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { Column, ColumnLineage, MetricKey, NodeMetrics } from "@/types";
import { useColumnLineage, useColumnUsage, useGraph, useNodeDetail } from "./api";
import { computeLayout } from "./layout";
import { NodePanel } from "./NodePanel";
import { CollapsedNode, HeaderNode, ModelNode } from "./nodes";
import { type ColorOption, ColorOptionList, SidebarMenu, SwitchRow } from "./SidebarMenu";

const NODE_TYPES = { model: ModelNode, header: HeaderNode, collapsed: CollapsedNode };

// Custom layer order is saved per project in localStorage. On load it's
// reconciled against the graph's current layers: layers that no longer exist
// are dropped, new ones are appended in their default order.
const layerOrderKey = (projectId: string) => `dbtsteroids-layer-order:${projectId}`;

function loadLayerOrder(projectId: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(layerOrderKey(projectId));
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(saved)) return defaults;
    const known = new Set(defaults);
    const kept = saved.filter((n): n is string => typeof n === "string" && known.has(n));
    const keptSet = new Set(kept);
    return [...kept, ...defaults.filter((n) => !keptSet.has(n))];
  } catch {
    return defaults;
  }
}

function saveLayerOrder(projectId: string, order: string[] | null) {
  try {
    if (order) localStorage.setItem(layerOrderKey(projectId), JSON.stringify(order));
    else localStorage.removeItem(layerOrderKey(projectId));
  } catch {
    /* ignore quota/private-mode errors */
  }
}

// Each metric's description says what it measures, plus what the cool (0) and
// hot (high) ends of its heat scale mean — shown in the "Color by metric" menu.
const METRICS: { key: MetricKey; label: string; description: string; low: string; high: string }[] = [
  {
    key: "downstream_count",
    label: "Downstream users (hotspots)",
    description: "Models that depend on this one, directly or indirectly.",
    low: "nothing uses it",
    high: "a hotspot many models rely on; a change ripples far",
  },
  {
    key: "upstream_count",
    label: "Upstream depth",
    description: "Models and sources feeding this one, directly or indirectly.",
    low: "close to the sources",
    high: "deep in the pipeline",
  },
  {
    key: "fan_out",
    label: "Direct dependents",
    description: "Models that read from this one directly.",
    low: "a leaf nobody reads",
    high: "widely reused",
  },
  {
    key: "fan_in",
    label: "Direct inputs",
    description: "Models and sources this one reads directly.",
    low: "no inputs",
    high: "joins many inputs together",
  },
  {
    key: "betweenness",
    label: "Betweenness centrality",
    description: "How often this model sits on the paths between other models.",
    low: "on no path",
    high: "a bridge or bottleneck much of the graph flows through",
  },
  {
    key: "degree_centrality",
    label: "Degree centrality",
    description: "Share of all models directly connected to this one (inputs + dependents).",
    low: "isolated",
    high: "heavily connected",
  },
  {
    key: "hotspot_score",
    label: "Hotspot score",
    description: "Downstream users scaled 0–1 against the most-used model.",
    low: "unused",
    high: "the most-used model",
  },
  {
    key: "complexity",
    label: "SQL complexity",
    description: "Weighted count of joins, CTEs, subqueries, window functions and CASE expressions.",
    low: "a plain select",
    high: "complex SQL that's hard to read and change",
  },
  {
    key: "loc",
    label: "Lines of code",
    description: "Non-blank lines of SQL.",
    low: "no SQL",
    high: "a long model",
  },
  {
    key: "test_count",
    label: "Test count",
    description: "Tests that reference this model.",
    low: "untested",
    high: "well covered (here high is good)",
  },
  {
    key: "cohesion",
    label: "Cohesion",
    description: "1 ÷ number of distinct upstream inputs.",
    low: "pulls from many inputs",
    high: "reads from a single input (focused)",
  },
  {
    key: "column_count",
    label: "Column count",
    description: "Columns in the model.",
    low: "no known columns",
    high: "a wide model with a large footprint",
  },
  {
    key: "commit_count",
    label: "Commit count (churn)",
    description: "Git commits that touched the model's file.",
    low: "never changed (or no git history)",
    high: "changes often",
  },
  {
    key: "doc_coverage",
    label: "Documentation coverage",
    description: "Share of the model description + its columns that have a description.",
    low: "nothing documented",
    high: "fully documented (here high is good)",
  },
  {
    key: "unused_column_count",
    label: "Unused columns",
    description:
      "Columns no downstream model reads. Only counted when every downstream model's SQL could be parsed; otherwise unknown and shown as 0 (run dbt compile for better coverage).",
    low: "every column is used, or unknown",
    high: "many columns nobody reads (dead weight to drop)",
  },
  {
    key: "days_since_change",
    label: "Days since last change",
    description: "Days since the last git commit touching the model's file.",
    low: "changed today (or no git history)",
    high: "untouched for a long time (stale)",
  },
];

// Icon per metric in the "Color by metric" menu.
const METRIC_ICONS: Record<MetricKey, LucideIcon> = {
  downstream_count: Users,
  upstream_count: ListTree,
  fan_out: ArrowRightFromLine,
  fan_in: ArrowRightToLine,
  betweenness: Milestone,
  degree_centrality: Share2,
  hotspot_score: Flame,
  complexity: Puzzle,
  loc: FileCode,
  test_count: FlaskConical,
  cohesion: Target,
  column_count: Columns3,
  commit_count: GitCommitHorizontal,
  doc_coverage: BookOpen,
  unused_column_count: EyeOff,
  days_since_change: CalendarClock,
};

// Categorical colorings (discrete palette + legend) live alongside the numeric
// heat metrics in the same "Color by" menu.
const STATUS_COLOR_KEY = "column_lineage_status";
const OWNER_COLOR_KEY = "git_owner";
const RISK_COLOR_KEY = "ownership_risk";
const ERROR_COLOR_KEY = "error_count";
const MATERIALIZATION_COLOR_KEY = "materialization";
// No coloring: every card gets the same neutral tint (the default).
const NONE_COLOR_KEY = "none";
const NEUTRAL_TINT = "var(--color-muted)";
type ColorKey =
  | MetricKey
  | typeof NONE_COLOR_KEY
  | typeof STATUS_COLOR_KEY
  | typeof OWNER_COLOR_KEY
  | typeof RISK_COLOR_KEY
  | typeof ERROR_COLOR_KEY
  | typeof MATERIALIZATION_COLOR_KEY;

const METRIC_KEYS = new Set<string>(METRICS.map((m) => m.key));
const isMetricKey = (k: ColorKey): k is MetricKey => METRIC_KEYS.has(k);

// Owner names can be long; nodes only have room for a short label.
const shortOwner = (owner: string): string => owner.split(/[\s@]/)[0] || owner;

// Fractional metrics get fixed decimals; counts stay whole numbers.
const DECIMALS: Partial<Record<keyof NodeMetrics, number>> = {
  cohesion: 2,
  hotspot_score: 3,
  betweenness: 3,
  degree_centrality: 3,
};

function formatBadge(key: keyof NodeMetrics, v: number): string {
  if (key === "doc_coverage") return `${Math.round(v * 100)}%`;
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
  const [colorBy, setColorBy] = useState<ColorKey>(NONE_COLOR_KEY);
  const colorByStatus = colorBy === STATUS_COLOR_KEY;
  const colorByOwner = colorBy === OWNER_COLOR_KEY;
  const colorByRisk = colorBy === RISK_COLOR_KEY;
  const colorByError = colorBy === ERROR_COLOR_KEY;
  const colorByMaterialization = colorBy === MATERIALIZATION_COLOR_KEY;
  // Categorical/owner/risk colorings don't use the heat scale or metric badges.
  const colorByNone = colorBy === NONE_COLOR_KEY;
  const isCategorical =
    colorByNone || colorByStatus || colorByOwner || colorByRisk || colorByError || colorByMaterialization;
  // Numeric metric backing ordering + badges; falls back to a sensible default
  // when a non-metric coloring (status/owner/risk) is active.
  const metric: MetricKey = isMetricKey(colorBy) ? colorBy : "downstream_count";
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  // "Check relationship" mode: a distinct interaction from single-selection.
  // While active, clicking two models picks endpoints A→B and the connecting
  // subgraph (if any directed path exists) is painted green.
  const [relMode, setRelMode] = useState(false);
  const [relEndpoints, setRelEndpoints] = useState<{ a: string | null; b: string | null }>({
    a: null,
    b: null,
  });
  // "Layer dependencies" mode: pick a parent and a child layer and highlight
  // every direct parent→child edge between them (e.g. reporting → reporting
  // finds reports built on top of other reports). Exclusive with relationship.
  const [layerMode, setLayerMode] = useState(false);
  const [layerPair, setLayerPair] = useState<{ parent: string; child: string }>({
    parent: "reporting",
    child: "reporting",
  });
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
  // Layout refinement: `flatten` ignores semantic layers and columns by dependency depth.
  const [flatten, setFlatten] = useState(false);
  const [search, setSearch] = useState("");
  // Filter-by-owner: union of the selected actors' models is highlighted (like
  // search). Driven by clicking chips in the owner legend.
  const [ownerFilter, setOwnerFilter] = useState<Set<string>>(new Set());
  // Focus-tab depth control: how many hops of parents/children to include, and
  // in which direction. null depth = the whole lineage.
  const [focusDepth, setFocusDepth] = useState<number | null>(null);
  const [focusDirection, setFocusDirection] = useState<FocusDirection>("both");
  // Column-flow (focus mode only): trace one of the focused model's columns
  // both up (source columns it derives from) and down (columns it feeds), and
  // dim everything off that column's path. A toggle + per-column picker.
  const [columnFlow, setColumnFlow] = useState(false);
  const [flowColumn, setFlowColumn] = useState<string | null>(null);

  // On first load, collapse oversized layers (e.g. 200+ sources) so the swimlane
  // graph fits the viewport instead of stretching thousands of px tall.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph && initializedFor.current !== projectId) {
      initializedFor.current = projectId;
      setCollapsed(new Set(graph.layers.filter((l) => l.node_ids.length > 50).map((l) => l.name)));
      setLayerOrder(
        loadLayerOrder(
          projectId,
          graph.layers.map((l) => l.name),
        ),
      );
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

  // Distinct git owners with their model counts (desc). Empty when the project
  // has no git ownership (upload-mode / non-git) — used to gate owner controls.
  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    if (graph) {
      for (const n of graph.nodes) {
        const o = n.metrics.owner;
        if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([owner, count]) => ({ owner, count }));
  }, [graph]);
  const ownershipTracked = owners.length > 0;

  // Materialization categories present in this graph (in legend order) — for the
  // "Color by: Materialization" legend.
  const materializations = useMemo(() => {
    if (!graph) return [];
    const present = new Set(graph.nodes.map((n) => materializationCategory(n.resource_type, n.materialized)));
    return MATERIALIZATION_LEGEND.filter((m) => present.has(m.key));
  }, [graph]);

  // Whether any model has uploaded errors — gates the "Errors" color mode.
  const errorsTracked = useMemo(
    () => !!graph && graph.nodes.some((n) => (n.metrics.error_count ?? 0) > 0),
    [graph],
  );
  useEffect(() => {
    if (!errorsTracked && colorByError) setColorBy(NONE_COLOR_KEY);
  }, [errorsTracked, colorByError]);

  // Fall back to a metric coloring if the active project doesn't track ownership.
  useEffect(() => {
    if (!ownershipTracked && (colorByOwner || colorByRisk)) setColorBy(NONE_COLOR_KEY);
  }, [ownershipTracked, colorByOwner, colorByRisk]);

  const toggleOwner = useCallback((owner: string) => {
    setOwnerFilter((prev) => {
      const next = new Set(prev);
      next.has(owner) ? next.delete(owner) : next.add(owner);
      return next;
    });
  }, []);

  // Clicking a model highlights it + its direct inputs/dependents (one hop) and
  // the arrows in/out of it; everything else dims.
  // A model plus its direct parents/children, and the edges between them.
  const neighbourhood = useCallback(
    (id: string) => {
      const nodes = new Set<string>([id]);
      const edges = new Set<string>();
      for (const p of adjacency.parents.get(id) ?? []) {
        nodes.add(p);
        edges.add(`${p}->${id}`);
      }
      for (const c of adjacency.children.get(id) ?? []) {
        nodes.add(c);
        edges.add(`${id}->${c}`);
      }
      return { nodes, edges };
    },
    [adjacency],
  );
  const selectionHighlight = useMemo(
    () => (selectedNodeId ? neighbourhood(selectedNodeId) : null),
    [selectedNodeId, neighbourhood],
  );

  // Layer dependencies: direct edges from a model in the parent layer to a
  // model in the child layer. `children` lists each matching child with the
  // parents it reads, alphabetically.
  const layerDeps = useMemo(() => {
    if (!layerMode || !graph) return null;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const parentsOf = new Map<string, string[]>();
    for (const e of graph.edges) {
      const src = byId.get(e.src);
      const dst = byId.get(e.dst);
      if (!src || !dst || src.layer !== layerPair.parent || dst.layer !== layerPair.child) continue;
      nodes.add(e.src);
      nodes.add(e.dst);
      edges.add(`${e.src}->${e.dst}`);
      const list = parentsOf.get(e.dst) ?? [];
      list.push(src.name);
      parentsOf.set(e.dst, list);
    }
    const children = [...parentsOf.entries()]
      .map(([id, parents]) => ({ id, name: byId.get(id)?.name ?? id, parents: parents.sort() }))
      .sort((x, y) => x.name.localeCompare(y.name));
    return { nodes, edges, children };
  }, [layerMode, layerPair, graph]);

  // Relationship mode: the connecting subgraph between endpoints A and B, i.e.
  // every model on some directed path A→…→B (or B→…→A). Computed as
  // descendants(src) ∩ ancestors(dst) so parallel intermediate routes all light
  // up, not just one shortest path. `connected: false` ⇒ A and B are unrelated.
  const relationship = useMemo(() => {
    const { a, b } = relEndpoints;
    if (!graph || !a || !b) return null;
    const reach = (start: string, adj: Map<string, string[]>) => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop() as string;
        for (const nb of adj.get(cur) ?? []) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      return seen;
    };
    const orient = (src: string, dst: string) => {
      const desc = reach(src, adjacency.children);
      if (!desc.has(dst)) return null;
      const anc = reach(dst, adjacency.parents);
      const on = new Set<string>([src, dst]);
      for (const id of desc) if (anc.has(id)) on.add(id);
      return on;
    };
    const on = orient(a, b) ?? orient(b, a);
    if (!on) return { nodes: new Set<string>([a, b]), edges: new Set<string>(), connected: false };
    const edges = new Set<string>();
    for (const e of graph.edges) if (on.has(e.src) && on.has(e.dst)) edges.add(`${e.src}->${e.dst}`);
    return { nodes: on, edges, connected: true };
  }, [relEndpoints, graph, adjacency]);

  // Search / filter: matched node set (name substring + owner filter). Null when
  // no filter is active.
  const filterActive = search.trim() !== "" || ownerFilter.size > 0;
  const filterMatch = useMemo(() => {
    if (!graph || !filterActive) return null;
    const q = search.trim().toLowerCase();
    const matched = new Set<string>();
    for (const n of graph.nodes) {
      if (q && !n.name.toLowerCase().includes(q)) continue;
      if (ownerFilter.size > 0 && !(n.metrics.owner && ownerFilter.has(n.metrics.owner))) continue;
      matched.add(n.id);
    }
    return matched;
  }, [graph, filterActive, search, ownerFilter]);

  // Column-flow data: the focused model's columns (for the picker) and the
  // selected column's up+down lineage. Both hooks stay disabled unless the
  // toggle is on inside a focus tab.
  const { data: focusNode } = useNodeDetail(projectId, columnFlow ? focusId : null);
  const { data: flowLineage, isFetching: flowLoading } = useColumnLineage(
    projectId,
    focusId,
    columnFlow ? flowColumn : null,
    "both",
  );

  // Leaving a focus tab (or switching tabs) resets the column-flow toggle so it
  // never leaks a stale column onto a different model.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed only on the active tab
  useEffect(() => {
    setColumnFlow(false);
    setFlowColumn(null);
  }, [activeKey]);

  // Turning the toggle on with no column chosen defaults to the first traceable
  // column so the canvas shows a flow immediately.
  useEffect(() => {
    if (columnFlow && focusNode && !flowColumn) {
      const first = focusNode.columns.find((c) => c.has_lineage);
      if (first) setFlowColumn(first.name);
    }
  }, [columnFlow, focusNode, flowColumn]);

  // Nodes/edges touched by the traced column — same shape as a column trace,
  // used to highlight the flow (and dim the rest) inside the focus subgraph.
  const columnFlowHighlight = useMemo(() => {
    if (!columnFlow || !focusId || !flowLineage) return null;
    return {
      nodes: new Set<string>(flowLineage.columns.map((c) => c.node_id)),
      edges: new Set<string>(flowLineage.edges.map((e) => `${e.src.node_id}->${e.dst.node_id}`)),
    };
  }, [columnFlow, focusId, flowLineage]);

  // Highlight priority: relationship > column trace > node selection > filter.
  const highlight = useMemo(() => {
    // Relationship overrides even inside a focus tab: we always want off-path
    // nodes dimmed so the green connecting route stands out.
    if (relationship) return { nodes: relationship.nodes, edges: relationship.edges };
    if (layerDeps) return { nodes: layerDeps.nodes, edges: layerDeps.edges };
    if (trace) {
      return {
        nodes: new Set<string>(trace.lineage.columns.map((c) => c.node_id)),
        edges: new Set<string>(trace.lineage.edges.map((e) => `${e.src.node_id}->${e.dst.node_id}`)),
      };
    }
    // In a focus tab everything shown is already the relevant subgraph. Column
    // flow is the exception: when tracing a column we DO dim off-path nodes so
    // the source→…→consumer route stands out. Otherwise selecting a node only
    // highlights its in/out ARROWS (dimming would make related nodes look
    // unrelated).
    if (focusId) {
      if (columnFlowHighlight) return columnFlowHighlight;
      return { nodes: undefined, edges: selectionHighlight?.edges };
    }
    if (selectionHighlight) return selectionHighlight;
    if (filterMatch) return { nodes: filterMatch, edges: new Set<string>() };
    return { nodes: undefined, edges: undefined };
  }, [relationship, layerDeps, trace, focusId, columnFlowHighlight, selectionHighlight, filterMatch]);

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

  // A connecting path often threads through a collapsed layer (e.g. sources).
  // Expand every layer that holds a path node so the green route is visible.
  useEffect(() => {
    const shown = relationship?.connected ? relationship.nodes : layerDeps?.nodes;
    if (!shown?.size || !graph) return;
    const touched = new Set<string>();
    for (const n of graph.nodes) if (shown.has(n.id)) touched.add(n.layer);
    setCollapsed((prev) => {
      if (![...touched].some((l) => prev.has(l))) return prev;
      const next = new Set(prev);
      for (const l of touched) next.delete(l);
      return next;
    });
  }, [relationship, layerDeps, graph]);

  // Column-usage fractions for the selected node's neighbours.
  const { data: usage } = useColumnUsage(projectId, selectedNodeId);

  // Right-aligned node badges: the active "Color by" metric when nothing is
  // selected (so the number matches the coloring); the selected node shows its
  // column count and each neighbour shows used/total columns across the edge.
  // `badgeMetric: "none"` still acts as an off switch for the per-node number.
  const badges = useMemo(() => {
    const map = new Map<string, string>();
    if (!graph) return map;
    // Column flow: tag every node on the traced column's path with its own
    // column name(s) so you can read which column each upstream/downstream
    // model contributes.
    if (columnFlow && focusId && flowLineage) {
      const byNode = new Map<string, Set<string>>();
      for (const c of flowLineage.columns) {
        const cols = byNode.get(c.node_id) ?? new Set<string>();
        cols.add(c.column);
        byNode.set(c.node_id, cols);
      }
      for (const [nid, cols] of byNode) map.set(nid, [...cols].join(", "));
      return map;
    }
    if (selectedNodeId) {
      const sel = graph.nodes.find((n) => n.id === selectedNodeId);
      if (sel) map.set(selectedNodeId, `${sel.metrics.column_count} cols`);
      if (settings.showColumnFractions && usage) {
        for (const u of [...usage.upstream, ...usage.downstream]) {
          map.set(u.node_id, u.total > 0 ? `${u.used}/${u.total}` : "–");
        }
      }
    } else if (colorByOwner) {
      // Label each node with its owner so the color legend is readable at a glance.
      for (const n of graph.nodes) {
        if (n.metrics.owner) map.set(n.id, shortOwner(n.metrics.owner));
      }
    } else if (colorByError) {
      // Label error-heavy nodes with their error count.
      for (const n of graph.nodes) {
        const c = n.metrics.error_count ?? 0;
        if (c > 0) map.set(n.id, `${c} err`);
      }
    } else if (colorByMaterialization) {
      // Label each node with its materialization category.
      for (const n of graph.nodes) map.set(n.id, materializationCategory(n.resource_type, n.materialized));
    } else if (!isCategorical && settings.badgeMetric !== "none") {
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
    colorByOwner,
    colorByError,
    colorByMaterialization,
    isCategorical,
    settings.badgeMetric,
    settings.showColumnFractions,
    columnFlow,
    focusId,
    flowLineage,
  ]);

  // Owner / risk colorings resolve a full per-node tint map that overrides the
  // metric heat scale in the layout (see layout.ts tintOverride).
  const tintOverride = useMemo(() => {
    if (!graph) return undefined;
    if (colorByNone) return new Map(graph.nodes.map((n) => [n.id, NEUTRAL_TINT]));
    if (colorByOwner) {
      const m = new Map<string, string>();
      for (const n of graph.nodes) m.set(n.id, ownerColor(n.metrics.owner));
      return m;
    }
    if (colorByRisk) {
      let maxDownstream = 0;
      for (const n of graph.nodes) maxDownstream = Math.max(maxDownstream, n.metrics.downstream_count);
      const m = new Map<string, string>();
      for (const n of graph.nodes) m.set(n.id, hotspotColor(riskScore(n.metrics, maxDownstream)));
      return m;
    }
    if (colorByError) {
      let maxErrors = 0;
      for (const n of graph.nodes) maxErrors = Math.max(maxErrors, n.metrics.error_count ?? 0);
      const m = new Map<string, string>();
      for (const n of graph.nodes) {
        const norm = maxErrors > 0 ? (n.metrics.error_count ?? 0) / maxErrors : 0;
        m.set(n.id, errorColor(norm));
      }
      return m;
    }
    if (colorByMaterialization) {
      const m = new Map<string, string>();
      for (const n of graph.nodes) m.set(n.id, materializationColor(n.resource_type, n.materialized));
      return m;
    }
    return undefined;
  }, [graph, colorByNone, colorByOwner, colorByRisk, colorByError, colorByMaterialization]);

  // Endpoint candidates for the relationship card, alphabetical.
  const pickableModels = useMemo(
    () =>
      (graph?.nodes ?? [])
        .map((n) => ({ id: n.id, name: n.name }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    [graph],
  );

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
      flatten,
      colorByStatus,
      tintOverride,
      connect: !!relationship || !!layerDeps?.nodes.size,
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
    flatten,
    colorByStatus,
    tintOverride,
    relationship,
    layerDeps,
  ]);

  const reorderLayers = useCallback(
    (from: number, to: number) => {
      const base = layerOrder ?? graph?.layers.map((l) => l.name) ?? [];
      if (from < 0 || from >= base.length || to < 0 || to >= base.length) return;
      const next = [...base];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setLayerOrder(next);
      saveLayerOrder(projectId, next);
    },
    [graph, layerOrder, projectId],
  );

  const resetLayerOrder = useCallback(() => {
    setLayerOrder(graph?.layers.map((l) => l.name) ?? null);
    saveLayerOrder(projectId, null);
  }, [graph, projectId]);

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
        // In relationship mode a click feeds endpoints A→B (a third click
        // restarts) instead of opening the single-selection panel.
        if (relMode) {
          setRelEndpoints((prev) => {
            if (!prev.a) return { a: node.id, b: null };
            if (!prev.b) return prev.a === node.id ? prev : { a: prev.a, b: node.id };
            return { a: node.id, b: null };
          });
          return;
        }
        setSelectedNodeId(node.id);
        setTrace(null);
      }
    },
    [toggleLayer, relMode],
  );

  // Clicking empty canvas deselects the current model (and clears any column
  // trace), returning to the un-dimmed "All" view without a full reload.
  const onPaneClick = useCallback(() => {
    setMenu(null);
    setSelectedNodeId(null);
    setTrace(null);
  }, []);

  // Focusing the search box takes priority over a single selection: drop the
  // selection (and trace) so the search/filter highlight drives the canvas.
  const onSearchFocus = useCallback(() => {
    setSelectedNodeId(null);
    setTrace(null);
  }, []);

  // Toggling the mode off clears endpoints; toggling on drops any single
  // selection so the two interactions never fight over the highlight.
  const toggleRelMode = useCallback(() => {
    setRelMode((on) => {
      if (on) setRelEndpoints({ a: null, b: null });
      else {
        setSelectedNodeId(null);
        setTrace(null);
        setLayerMode(false);
      }
      return !on;
    });
  }, []);

  const toggleLayerMode = useCallback(() => {
    setLayerMode((on) => {
      if (!on) {
        setRelMode(false);
        setRelEndpoints({ a: null, b: null });
        setSelectedNodeId(null);
        setTrace(null);
      }
      return !on;
    });
  }, []);

  // Keyboard: ⇧⌘F (⇧Ctrl-F) focuses the model search, Esc clears the search,
  // selection and any column trace.
  const { update: updateSettings } = useSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!settings.sidebarExpanded) updateSettings({ sidebarExpanded: true });
        // The search box lives in the sidebar portal; wait a tick if it was collapsed.
        setTimeout(() => document.getElementById(SEARCH_INPUT_ID)?.focus(), 0);
      } else if (e.key === "Escape") {
        setSearch("");
        setSelectedNodeId(null);
        setTrace(null);
        if (document.activeElement?.id === SEARCH_INPUT_ID) (document.activeElement as HTMLElement).blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.sidebarExpanded, updateSettings]);

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
          onPaneClick={onPaneClick}
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
          <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-2">
            <FocusDepthControl
              depth={focusDepth}
              onDepth={setFocusDepth}
              direction={focusDirection}
              onDirection={setFocusDirection}
              count={focusSet?.size ?? 1}
            />
            <ColumnFlowControl
              active={columnFlow}
              onToggle={() => setColumnFlow((v) => !v)}
              columns={focusNode?.columns ?? []}
              column={flowColumn}
              onColumn={setFlowColumn}
              sourceCount={flowLineage?.source_columns.length ?? null}
              partial={flowLineage?.partial ?? false}
              loading={flowLoading}
            />
          </div>
        )}

        {/* Dock the controls into the left sidebar; when the sidebar is
            collapsed (no slot) we simply hide them rather than float a panel
            over the canvas. */}
        {sidebarSlot &&
          createPortal(
            <>
              <SearchBar
                search={search}
                onSearch={setSearch}
                onFocus={onSearchFocus}
                matchCount={filterMatch?.size ?? null}
              />
              <Toolbar
                colorBy={colorBy}
                onColorBy={setColorBy}
                layerCount={graph.layers.length}
                collapsedCount={collapsed.size}
                onExpandAll={() => setCollapsed(new Set())}
                onCollapseAll={() => setCollapsed(new Set(graph.layers.map((l) => l.name)))}
                flatten={flatten}
                onFlatten={() => setFlatten((v) => !v)}
                layerOrder={layerOrder ?? graph.layers.map((l) => l.name)}
                onReorderLayers={reorderLayers}
                onResetLayerOrder={resetLayerOrder}
                canResetLayerOrder={
                  !!layerOrder && layerOrder.join() !== graph.layers.map((l) => l.name).join()
                }
                ownershipTracked={ownershipTracked}
                errorsTracked={errorsTracked}
                relMode={relMode}
                onToggleRelMode={toggleRelMode}
                layerMode={layerMode}
                onToggleLayerMode={toggleLayerMode}
              />
            </>,
            sidebarSlot,
          )}

        {layerMode && layerDeps ? (
          <LayerDependencyCard
            layers={graph.layers.map((l) => l.name)}
            pair={layerPair}
            onPair={setLayerPair}
            result={layerDeps.children}
            onClose={toggleLayerMode}
          />
        ) : relMode ? (
          <RelationshipCard
            models={pickableModels}
            endpointA={relEndpoints.a}
            endpointB={relEndpoints.b}
            onPick={(slot, id) => setRelEndpoints((prev) => ({ ...prev, [slot]: id }))}
            result={relationship}
            onClear={() => setRelEndpoints({ a: null, b: null })}
            onClose={toggleRelMode}
          />
        ) : colorByNone ? null : (
          <GraphLegend
            colorBy={colorBy}
            owners={owners}
            ownerFilter={ownerFilter}
            onToggleOwner={toggleOwner}
            onClearOwners={() => setOwnerFilter(new Set())}
            materializations={materializations}
          />
        )}

        <div className="-translate-x-1/2 absolute top-4 left-1/2 z-10 flex flex-col items-center gap-2">
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
    <div className="flex items-center gap-2 rounded-md border border-border bg-panel/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur">
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

function ColumnFlowControl({
  active,
  onToggle,
  columns,
  column,
  onColumn,
  sourceCount,
  partial,
  loading,
}: {
  active: boolean;
  onToggle: () => void;
  columns: Column[];
  column: string | null;
  onColumn: (c: string) => void;
  sourceCount: number | null;
  partial: boolean;
  loading: boolean;
}) {
  const traceable = columns.filter((c) => c.has_lineage);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-panel/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        title="Trace one column's upstream sources and downstream propagation across this model's lineage"
        className={cn(
          "flex items-center gap-1.5 rounded border px-2 py-0.5",
          active ? "border-sky-500 bg-sky-500/15 text-fg" : "border-border text-muted hover:text-fg",
        )}
      >
        <Waypoints size={13} /> Column flow
      </button>
      {active &&
        (traceable.length === 0 ? (
          <span className="text-muted">no column lineage</span>
        ) : (
          <>
            <select
              value={column ?? ""}
              onChange={(e) => onColumn(e.target.value)}
              className="max-w-[160px] rounded border border-border bg-panel-2 px-1.5 py-0.5 text-fg outline-none"
            >
              {traceable.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            {loading ? (
              <span className="text-muted">tracing…</span>
            ) : (
              sourceCount !== null && (
                <span className="text-muted">
                  {partial && <span className="text-amber-400">partial · </span>}
                  {sourceCount} source col(s)
                </span>
              )
            )}
          </>
        ))}
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

const SEARCH_INPUT_ID = "lineage-model-search";

// Model search at the top of the left sidebar. Matches highlight in the graph.
function SearchBar({
  search,
  onSearch,
  onFocus,
  matchCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  onFocus: () => void;
  matchCount: number | null;
}) {
  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs focus-within:border-accent">
        <Search size={13} className="shrink-0 text-muted" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          id={SEARCH_INPUT_ID}
          onFocus={onFocus}
          placeholder="Search models…  ⇧⌘F"
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
        />
        {matchCount !== null && <span className="shrink-0 text-[11px] text-muted">{matchCount}</span>}
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            title="Clear search"
            className="shrink-0 text-muted hover:text-fg"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// Bottom-left card while "Layer dependencies" is on (replaces the legend):
// pick the parent and child layer; lists each child model that directly reads
// a model in the parent layer, with the parents it reads.
function LayerDependencyCard({
  layers,
  pair,
  onPair,
  result,
  onClose,
}: {
  layers: string[];
  pair: { parent: string; child: string };
  onPair: (p: { parent: string; child: string }) => void;
  result: { id: string; name: string; parents: string[] }[];
  onClose: () => void;
}) {
  const select = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-2 py-1 text-fg outline-none"
    >
      {layers.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div className="absolute bottom-4 left-16 z-10 flex w-96 flex-col gap-2 rounded-lg border border-border bg-panel/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <Network size={13} className="text-emerald-400" />
        <span className="flex-1 font-medium text-[10px] text-muted uppercase tracking-wide">
          Layer dependencies
        </span>
        <button type="button" onClick={onClose} title="Close" className="text-muted hover:text-fg">
          <X size={13} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-muted">Parent</span>
        {select(pair.parent, (parent) => onPair({ ...pair, parent }))}
        <button
          type="button"
          onClick={() => onPair({ parent: pair.child, child: pair.parent })}
          title="Swap parent and child"
          className="rounded border border-border p-1 text-muted hover:text-fg"
        >
          <ArrowLeftRight size={12} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-muted">Child</span>
        {select(pair.child, (child) => onPair({ ...pair, child }))}
        <span className="w-[26px] shrink-0" />
      </div>
      {result.length === 0 ? (
        <span className="text-[11px] text-muted">
          No {pair.child} model reads a {pair.parent} model directly.
        </span>
      ) : (
        <>
          <span className="text-emerald-400">
            {result.length} {pair.child} model{result.length === 1 ? "" : "s"} read
            {result.length === 1 ? "s" : ""} from {pair.parent} directly
          </span>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
            {result.map((r) => (
              <li key={r.id} className="flex flex-col">
                <span className="truncate font-medium text-fg" title={r.name}>
                  {r.name}
                </span>
                <span className="truncate text-[11px] text-muted" title={r.parents.join(", ")}>
                  ← {r.parents.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Bottom-left card while "Check relationship" is on (replaces the legend).
// Pick endpoints A and B by typing a model name, or by clicking models on the
// graph; the connecting subgraph is painted green.
function RelationshipCard({
  models,
  endpointA,
  endpointB,
  onPick,
  result,
  onClear,
  onClose,
}: {
  models: { id: string; name: string }[];
  endpointA: string | null;
  endpointB: string | null;
  onPick: (slot: "a" | "b", id: string | null) => void;
  result: { connected: boolean; nodes: Set<string> } | null;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-16 z-10 flex w-80 flex-col gap-2 rounded-lg border border-border bg-panel/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <Route size={13} className="text-emerald-400" />
        <span className="flex-1 font-medium text-[10px] text-muted uppercase tracking-wide">
          Check relationship
        </span>
        {(endpointA || endpointB) && (
          <button type="button" onClick={onClear} className="text-[11px] text-muted underline hover:text-fg">
            clear
          </button>
        )}
        <button type="button" onClick={onClose} title="Close" className="text-muted hover:text-fg">
          <X size={13} />
        </button>
      </div>
      <ModelPicker label="A" models={models} value={endpointA} onChange={(id) => onPick("a", id)} />
      <ModelPicker label="B" models={models} value={endpointB} onChange={(id) => onPick("b", id)} />
      {result ? (
        result.connected ? (
          <span className="text-emerald-400">Connected · {result.nodes.size} model(s) on the path</span>
        ) : (
          <span className="text-amber-400">Not connected — no path between A and B</span>
        )
      ) : (
        <span className="text-[11px] text-muted">Type a name, or click two models on the graph.</span>
      )}
    </div>
  );
}

// Endpoint slot: shows the picked model, or a search box with suggestions
// (opening upward, since the card sits at the bottom of the canvas).
function ModelPicker({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const picked = value ? models.find((m) => m.id === value) : null;
  const q = query.trim().toLowerCase();
  // Rank: exact name (ignoring a "schema." prefix) → starts with → contains.
  const rank = (name: string) => {
    const n = name.toLowerCase();
    const short = n.slice(n.lastIndexOf(".") + 1);
    return n === q || short === q ? 0 : n.startsWith(q) || short.startsWith(q) ? 1 : 2;
  };
  const matches = q
    ? models
        .filter((m) => m.name.toLowerCase().includes(q))
        .sort((x, y) => rank(x.name) - rank(y.name))
        .slice(0, 8)
    : [];

  return (
    <div className="relative flex items-center gap-2">
      <span className="w-3 shrink-0 font-semibold text-emerald-400">{label}</span>
      {picked ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-panel-2 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-fg" title={picked.name}>
            {picked.name}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Remove"
            className="text-muted hover:text-fg"
          >
            <X size={11} />
          </button>
        </span>
      ) : (
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              onChange(matches[0].id);
              setQuery("");
            }
          }}
          placeholder="Search or click a model…"
          className="min-w-0 flex-1 rounded border border-border border-dashed bg-transparent px-2 py-1 text-fg outline-none placeholder:text-muted focus:border-accent focus:border-solid"
        />
      )}
      {open && !picked && matches.length > 0 && (
        <ul className="absolute right-0 bottom-full left-5 mb-1 max-h-56 overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-xl">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                // mousedown (not click) so it fires before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(m.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="w-full truncate px-2 py-1 text-left text-fg hover:bg-panel-2"
                title={m.name}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toolbar({
  colorBy,
  onColorBy,
  layerCount,
  collapsedCount,
  onExpandAll,
  onCollapseAll,
  flatten,
  onFlatten,
  layerOrder,
  onReorderLayers,
  onResetLayerOrder,
  canResetLayerOrder,
  ownershipTracked,
  errorsTracked,
  relMode,
  onToggleRelMode,
  layerMode,
  onToggleLayerMode,
}: {
  colorBy: ColorKey;
  onColorBy: (m: ColorKey) => void;
  layerCount: number;
  collapsedCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  flatten: boolean;
  onFlatten: () => void;
  layerOrder: string[];
  onReorderLayers: (from: number, to: number) => void;
  onResetLayerOrder: () => void;
  canResetLayerOrder: boolean;
  ownershipTracked: boolean;
  errorsTracked: boolean;
  relMode: boolean;
  onToggleRelMode: () => void;
  layerMode: boolean;
  onToggleLayerMode: () => void;
}) {
  const metricOptions: ColorOption<ColorKey>[] = [
    {
      key: NONE_COLOR_KEY,
      label: "None",
      icon: <CircleOff size={15} />,
      description: "No coloring: every model card looks the same.",
    },
    ...[...METRICS]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m) => {
        const Icon = METRIC_ICONS[m.key];
        return { ...m, icon: <Icon size={15} /> };
      }),
  ];
  const categoryOptions: ColorOption<ColorKey>[] = [
    {
      key: STATUS_COLOR_KEY,
      label: "Column lineage status",
      icon: <Workflow size={15} />,
      description:
        "Whether column-level lineage could be traced from the model's SQL: ok, partial, or failed.",
    },
    {
      key: MATERIALIZATION_COLOR_KEY,
      label: "Materialization",
      icon: <Database size={15} />,
      description: "How dbt builds the model: table, view, incremental, snapshot, ephemeral…",
    },
    ...(errorsTracked
      ? [
          {
            key: ERROR_COLOR_KEY,
            label: "Errors (failure heat)",
            icon: <TriangleAlert size={15} />,
            description: "Operational errors uploaded for this model.",
            low: "no errors",
            high: "fails often",
          } as const,
        ]
      : []),
    ...(ownershipTracked
      ? ([
          {
            key: OWNER_COLOR_KEY,
            label: "Git owner",
            icon: <UserRound size={15} />,
            description:
              "Top git contributor per model, one color per person. Click names in the legend to filter.",
          },
          {
            key: RISK_COLOR_KEY,
            label: "Ownership risk (bus factor)",
            icon: <ShieldAlert size={15} />,
            description:
              "Combines downstream impact, a single dominant owner and staleness. High = many models rely on code one person knows and hasn't touched recently.",
          },
        ] as const)
      : []),
  ];
  const allCollapsed = layerCount > 0 && collapsedCount === layerCount;

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-3 text-xs">
      <SidebarMenu icon={<Flame size={16} />} label="Metrics" title="Color by metric">
        {(close) => (
          <ColorOptionList
            scale={hotspotColor}
            options={metricOptions}
            value={colorBy}
            onChange={(k) => {
              onColorBy(k);
              close();
            }}
          />
        )}
      </SidebarMenu>
      <SidebarMenu icon={<Shapes size={16} />} label="Categories" title="Color by category">
        {(close) => (
          <ColorOptionList
            options={categoryOptions}
            value={colorBy}
            onChange={(k) => {
              onColorBy(k);
              close();
            }}
          />
        )}
      </SidebarMenu>
      <SidebarMenu icon={<Layers size={16} />} label="Layers" title="Layers">
        {() => (
          <div className="flex flex-col gap-2">
            <SwitchRow
              label="Show layers"
              description={
                flatten
                  ? "Off: columns follow dependency depth (longest path from a root)."
                  : "On: one column per layer (source → stage → dwh → …)."
              }
              checked={!flatten}
              onChange={onFlatten}
            />
            {/* Manual column order only applies to semantic layers, not
                flattened depth stages. */}
            {!flatten && (
              <LayerOrderList
                order={layerOrder}
                onReorder={onReorderLayers}
                onReset={onResetLayerOrder}
                canReset={canResetLayerOrder}
              />
            )}
          </div>
        )}
      </SidebarMenu>
      <SidebarMenu icon={<SlidersHorizontal size={16} />} label="Others" title="Others">
        {() => (
          <SwitchRow
            label="Collapse all layers"
            description={
              flatten
                ? "Only available when layers are on."
                : `On: fold every layer into a single box. Off: show every model. (${collapsedCount} of ${layerCount} collapsed now)`
            }
            checked={allCollapsed}
            onChange={(on) => (on ? onCollapseAll() : onExpandAll())}
            disabled={flatten}
          />
        )}
      </SidebarMenu>

      <div className="mt-3 border-border border-t px-2.5 pt-3 pb-1 font-medium text-[10px] text-muted uppercase tracking-wide">
        Actions
      </div>
      <button
        type="button"
        onClick={onToggleRelMode}
        aria-pressed={relMode}
        title="Pick two models to check if (and how) they're connected"
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left font-medium",
          relMode ? "bg-emerald-500/15 text-fg ring-1 ring-emerald-500/50" : "text-fg hover:bg-panel-2",
        )}
      >
        <Route size={16} className={relMode ? "text-emerald-400" : "text-muted"} />
        <span className="flex-1">Check relationship</span>
      </button>
      <button
        type="button"
        onClick={onToggleLayerMode}
        aria-pressed={layerMode}
        title="Pick a parent and a child layer to see which models depend on which (e.g. reports built on reports)"
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left font-medium",
          layerMode ? "bg-emerald-500/15 text-fg ring-1 ring-emerald-500/50" : "text-fg hover:bg-panel-2",
        )}
      >
        <Network size={16} className={layerMode ? "text-emerald-400" : "text-muted"} />
        <span className="flex-1">Layer dependencies</span>
      </button>
    </div>
  );
}

// Floating legend for the active coloring, bottom-left of the canvas.
function GraphLegend({
  colorBy,
  owners,
  ownerFilter,
  onToggleOwner,
  onClearOwners,
  materializations,
}: {
  colorBy: ColorKey;
  owners: { owner: string; count: number }[];
  ownerFilter: Set<string>;
  onToggleOwner: (owner: string) => void;
  onClearOwners: () => void;
  materializations: { key: string; label: string; color: string }[];
}) {
  const title = colorBy === STATUS_COLOR_KEY ? "Column lineage status" : colorLabel(colorBy);
  return (
    <div className="absolute bottom-4 left-16 z-10 flex max-w-80 flex-col gap-1.5 rounded-lg border border-border bg-panel/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <span className="font-medium text-[10px] text-muted uppercase tracking-wide">{title}</span>
      {colorBy === OWNER_COLOR_KEY ? (
        <OwnerLegend
          owners={owners}
          ownerFilter={ownerFilter}
          onToggleOwner={onToggleOwner}
          onClearOwners={onClearOwners}
        />
      ) : colorBy === ERROR_COLOR_KEY ? (
        <ErrorLegend />
      ) : colorBy === MATERIALIZATION_COLOR_KEY ? (
        <SwatchLegend items={materializations} />
      ) : (
        <Legend status={colorBy === STATUS_COLOR_KEY} />
      )}
    </div>
  );
}

const CATEGORY_LABELS: Partial<Record<ColorKey, string>> = {
  [MATERIALIZATION_COLOR_KEY]: "Materialization",
  [ERROR_COLOR_KEY]: "Errors",
  [OWNER_COLOR_KEY]: "Git owner",
  [RISK_COLOR_KEY]: "Ownership risk",
};
const colorLabel = (k: ColorKey): string =>
  CATEGORY_LABELS[k] ?? METRICS.find((m) => m.key === k)?.label ?? k;

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

// Discrete swatch legend (label + color per row) — used by "Color by:
// Materialization". Shows only the categories present in the graph.
function SwatchLegend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((s) => (
        <span key={s.key} className="flex items-center gap-1 text-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// Green→red heat legend for "Color by: Errors".
function ErrorLegend() {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">none</span>
      <div className="flex h-3 w-32 overflow-hidden rounded">
        {stops.map((s) => (
          <div key={s} className="h-full flex-1" style={{ background: errorColor(s) }} />
        ))}
      </div>
      <span className="text-muted">most</span>
    </div>
  );
}

// Actor legend for "Color by: Git owner". Each row is a clickable chip that
// toggles the owner into the filter (union across selected actors), mirroring
// how search selects a node set.
function OwnerLegend({
  owners,
  ownerFilter,
  onToggleOwner,
  onClearOwners,
}: {
  owners: { owner: string; count: number }[];
  ownerFilter: Set<string>;
  onToggleOwner: (owner: string) => void;
  onClearOwners: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span>{owners.length} owners · click to filter</span>
        {ownerFilter.size > 0 && (
          <button type="button" onClick={onClearOwners} className="underline hover:text-fg">
            clear ({ownerFilter.size})
          </button>
        )}
      </div>
      <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto pr-1">
        {owners.map(({ owner, count }) => {
          const active = ownerFilter.has(owner);
          return (
            <button
              key={owner}
              type="button"
              onClick={() => onToggleOwner(owner)}
              aria-pressed={active}
              title={owner}
              className={cn(
                "flex items-center gap-2 rounded px-1.5 py-1 text-left text-[11px]",
                active
                  ? "bg-accent/15 text-fg ring-1 ring-accent/40"
                  : "text-muted hover:bg-panel-2 hover:text-fg",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ownerColor(owner) }} />
              <span className="min-w-0 flex-1 truncate">{owner}</span>
              <span className="shrink-0 tabular-nums text-muted">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Vertical, collapsible layer-order editor under the "Layers on" toggle. Top of
// the list = leftmost column; drag a row or use the arrows to move it.

function LayerOrderList({
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
    <div className="flex flex-col gap-1 border-border border-t px-2 pt-2.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-fg">Layer order</span>
        {canReset && <span className="text-[10px] text-accent">custom</span>}
      </div>
      <span className="text-[10px] text-muted/70">Top = leftmost column. Drag or use arrows.</span>
      <ul className="flex flex-col gap-0.5">
        {order.map((name, i) => (
          <li
            key={name}
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
              "flex cursor-grab items-center gap-1.5 rounded border px-1.5 py-1 active:cursor-grabbing",
              overIndex === i && dragIndex !== null && dragIndex !== i
                ? "border-accent bg-panel-2"
                : "border-transparent hover:bg-panel-2",
              dragIndex === i && "opacity-40",
            )}
          >
            <GripVertical size={12} className="shrink-0 text-muted" />
            <span className="w-4 shrink-0 text-right text-[10px] text-muted tabular-nums">{i + 1}</span>
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: layerColor(name) }} />
            <span className="min-w-0 flex-1 truncate text-fg" title={name}>
              {name}
            </span>
            <button
              type="button"
              onClick={() => onReorder(i, i - 1)}
              disabled={i === 0}
              title="Move up (left)"
              className="text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              onClick={() => onReorder(i, i + 1)}
              disabled={i === order.length - 1}
              title="Move down (right)"
              className="text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
            >
              <ArrowDown size={12} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        className="mt-1 flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
      >
        <RotateCcw size={12} /> Default order
      </button>
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

import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import { hotspotColor, statusColor } from "@/lib/colors";
import type { GraphResponse, MetricKey } from "@/types";

// Deterministic layered ("swimlane") layout: one column per layer in the
// canonical order the API returns, nodes stacked within each column. One opt-in
// refinement:
//   • flatten — ignore the semantic layers entirely and derive columns purely
//              from dependency depth (longest path from a root).
// No external layout engine — predictable and fast at dbt-project scale.

export const COLUMN_WIDTH = 320;
export const NODE_WIDTH = 230;
export const ROW_HEIGHT = 46;
const HEADER_Y = 0;
const FIRST_ROW_Y = 70;
const COLUMN_GAP = COLUMN_WIDTH - NODE_WIDTH; // horizontal breathing room between columns
const NODE_MAX_WIDTH = 620; // cap so one very long name can't blow the layout out

// Measure a node label's rendered width (px) so nodes can be sized to their
// full name and space columns without overlap. Uses a cached canvas
// context; falls back to a rough per-char estimate when there's no DOM (tests).
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureLabel(text: string): number {
  if (typeof document === "undefined") return text.length * 7;
  if (!_measureCtx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif";
    _measureCtx = ctx;
  }
  return _measureCtx ? _measureCtx.measureText(text).width : text.length * 7;
}

// Estimate the on-screen width of a model node from its label + trimmings
// (icon, badge, padding). Generous by design — the node itself is
// sized to `max-content`, so this only governs column spacing (over-estimating
// just adds a little slack, under-estimating would overlap).
function estimateNodeWidth(name: string, resourceType: string, badge?: string): number {
  const extras = 20 /* px-2.5 ×2 */ + 5 /* borders */ + 8 /* gaps */ + 24; /* buffer */
  const icon = resourceType === "source" || resourceType === "seed" ? 22 : 0;
  const badgeW = badge ? 10 + badge.length * 6.5 : 0;
  return Math.min(NODE_MAX_WIDTH, Math.ceil(measureLabel(name) + extras + icon + badgeW));
}

export interface ModelNodeData {
  label: string;
  layer: string;
  resourceType: string;
  tint: string; // resolved node fill color (heat scale, status, owner, or risk)
  dimmed: boolean;
  highlighted: boolean;
  connected: boolean; // on the green relationship path (relationship mode)
  badge?: string; // right-aligned chip (LOC / used·total column fraction / etc.)
  [key: string]: unknown;
}

export interface HeaderNodeData {
  layer: string;
  count: number;
  collapsed: boolean;
  label?: string; // display text (defaults to `layer`); flatten mode uses "STAGE n"
  accent?: string; // color override (flatten columns aren't a semantic layer)
  [key: string]: unknown;
}

export interface LayoutResult {
  nodes: RFNode[];
  edges: RFEdge[];
}

export interface LayoutOptions {
  collapsed: Set<string>;
  metric: MetricKey;
  highlightNodes?: Set<string>; // node ids to highlight; others dimmed
  activeEdges?: Set<string>; // "src->dst" node-level edges to mark active
  focusIds?: Set<string> | null; // when set, ONLY these nodes (+ their edges) are shown
  layerOrder?: string[]; // custom left-to-right column order (defaults to API order)
  badges?: Map<string, string>; // nodeId -> right-aligned badge text
  flatten?: boolean; // ignore semantic layers; columns = dependency depth
  colorByStatus?: boolean; // tint by column-lineage status instead of the metric heat scale
  tintOverride?: Map<string, string>; // node id -> fill color (owner / risk modes); wins over metric/status
  connect?: boolean; // relationship mode: paint the highlighted path/edges green
}

interface Column {
  name: string; // stable id (collapse key + header id)
  label: string; // display text
  accent?: string; // header/collapsed color override
  collapsed: boolean;
  nodeIds: string[]; // included node ids (all of them, even when collapsed)
}

const FLATTEN_ACCENT = "var(--color-muted)";

export function computeLayout(graph: GraphResponse, opts: LayoutOptions): LayoutResult {
  const { metric } = opts;

  // Color by percentile rank, not share of the max: one extreme hotspot would
  // otherwise push every other node into the coolest color. The lowest value
  // maps to 0 (coolest), the highest to 1 (hottest); equal values share a color.
  const sorted = graph.nodes.map((n) => n.metrics[metric] ?? 0).sort((a, b) => a - b);
  const below = new Map<number, number>(); // value -> how many nodes are strictly lower
  sorted.forEach((v, i) => {
    if (!below.has(v)) below.set(v, i);
  });
  const topRank = sorted.length ? (below.get(sorted[sorted.length - 1]) ?? 0) : 0;
  const norm = (v: number) => (topRank > 0 ? (below.get(v) ?? 0) / topRank : 0);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const highlightNodes = opts.highlightNodes ?? new Set<string>();
  const hasHighlight = highlightNodes.size > 0;
  const focusIds = opts.focusIds ?? null;
  const included = (id: string) => !focusIds || focusIds.has(id);

  // Flatten disables collapsing — the synthetic depth columns have no semantic
  // layer to fold into.
  const collapsedSet = opts.flatten || focusIds ? new Set<string>() : opts.collapsed;

  const metricOf = (id: string) => nodeById.get(id)?.metrics[metric] ?? 0;
  const byMetric = (ids: string[]) => [...ids].sort((a, b) => metricOf(b) - metricOf(a));

  // ---- Build the columns (left → right) -----------------------------------
  const columns: Column[] = opts.flatten
    ? flattenColumns(graph, included, byMetric)
    : semanticColumns(graph, opts.layerOrder, collapsedSet, included, byMetric);

  // ---- Edges (rewire collapsed endpoints to their layer node; dedupe) ------
  const columnName = new Map<string, string>();
  for (const c of columns) for (const id of c.nodeIds) columnName.set(id, c.name);
  const collapsedNames = new Set(columns.filter((c) => c.collapsed).map((c) => c.name));
  const endpoint = (id: string) => {
    const c = columnName.get(id);
    return c && collapsedNames.has(c) ? `layer:${c}` : id;
  };

  const edgeSet = new Set<string>();
  const slotEdges: { source: string; target: string; active: boolean }[] = [];
  for (const e of graph.edges) {
    if (!included(e.src) || !included(e.dst)) continue;
    const s = endpoint(e.src);
    const t = endpoint(e.dst);
    if (s === t) continue;
    const key = `${s}->${t}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    slotEdges.push({ source: s, target: t, active: opts.activeEdges?.has(`${e.src}->${e.dst}`) ?? false });
  }

  // ---- Column x-positions --------------------------------------------------
  // Nodes always show their full name, so each column is as wide as its widest
  // node (measured from the label); collapsed columns keep the fixed width.
  const columnX: number[] = [];
  {
    let acc = 0;
    for (const col of columns) {
      columnX.push(acc);
      if (col.collapsed) {
        acc += COLUMN_WIDTH;
      } else {
        let maxW = NODE_WIDTH;
        for (const id of col.nodeIds) {
          const n = nodeById.get(id);
          if (n) maxW = Math.max(maxW, estimateNodeWidth(n.name, n.resource_type, opts.badges?.get(n.id)));
        }
        acc += maxW + COLUMN_GAP;
      }
    }
  }

  // ---- Emit React Flow nodes ----------------------------------------------
  const rfNodes: RFNode[] = [];
  columns.forEach((col, colIndex) => {
    const x = columnX[colIndex];
    rfNodes.push({
      id: `header:${col.name}`,
      type: "header",
      position: { x, y: HEADER_Y },
      data: {
        layer: col.name,
        label: col.label,
        accent: col.accent,
        count: col.nodeIds.length,
        collapsed: col.collapsed,
      } satisfies HeaderNodeData,
      draggable: false,
      selectable: false,
    });

    if (col.collapsed) {
      rfNodes.push({
        id: `layer:${col.name}`,
        type: "collapsed",
        position: { x, y: FIRST_ROW_Y },
        data: {
          layer: col.name,
          label: col.label,
          accent: col.accent,
          count: col.nodeIds.length,
          collapsed: true,
        } satisfies HeaderNodeData,
        draggable: false,
      });
      return;
    }

    col.nodeIds.forEach((id, rowIndex) => {
      const n = nodeById.get(id);
      if (!n) return;
      const highlighted = hasHighlight && highlightNodes.has(n.id);
      rfNodes.push({
        id: n.id,
        type: "model",
        position: { x, y: FIRST_ROW_Y + rowIndex * ROW_HEIGHT },
        data: {
          label: n.name,
          layer: n.layer,
          resourceType: n.resource_type,
          tint:
            opts.tintOverride?.get(n.id) ??
            (opts.colorByStatus
              ? statusColor(n.column_lineage_status)
              : hotspotColor(norm(n.metrics[metric] ?? 0))),
          dimmed: hasHighlight && !highlighted,
          highlighted,
          connected: !!opts.connect && highlighted,
          badge: opts.badges?.get(n.id),
        } satisfies ModelNodeData,
        draggable: false,
      });
    });
  });

  const rfEdges: RFEdge[] = slotEdges.map((e) => {
    const dimmed = hasHighlight && !e.active;
    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      className: e.active ? (opts.connect ? "connected" : "active") : dimmed ? "dimmed" : undefined,
      zIndex: e.active ? 10 : 0,
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

// One column per semantic layer, in the user's chosen (or API) order.
function semanticColumns(
  graph: GraphResponse,
  layerOrder: string[] | undefined,
  collapsedSet: Set<string>,
  included: (id: string) => boolean,
  byMetric: (ids: string[]) => string[],
): Column[] {
  // In focus mode only layers containing a focused node are shown.
  const visible = graph.layers.filter((layer) => layer.node_ids.some(included));
  const rank = layerOrder ? new Map(layerOrder.map((n, i) => [n, i])) : null;
  const ordered = rank
    ? [...visible].sort((a, b) => (rank.get(a.name) ?? 999) - (rank.get(b.name) ?? 999))
    : visible;

  return ordered.map((layer) => {
    const collapsed = collapsedSet.has(layer.name);
    const ids = layer.node_ids.filter(included);
    return {
      name: layer.name,
      label: layer.name,
      collapsed,
      // Collapsed columns render as one node, so ordering doesn't matter there.
      nodeIds: collapsed ? ids : byMetric(ids),
    };
  });
}

// Ignore semantic layers: place each node at its dependency depth (longest path
// from a root within the visible subgraph), one column per depth level.
function flattenColumns(
  graph: GraphResponse,
  included: (id: string) => boolean,
  byMetric: (ids: string[]) => string[],
): Column[] {
  const ids = graph.nodes.filter((n) => included(n.id)).map((n) => n.id);
  const idSet = new Set(ids);

  const parents = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!idSet.has(e.src) || !idSet.has(e.dst)) continue;
    (parents.get(e.dst) ?? parents.set(e.dst, []).get(e.dst))?.push(e.src);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // defensive cycle guard
    visiting.add(id);
    let d = 0;
    for (const p of parents.get(id) ?? []) d = Math.max(d, depthOf(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const buckets = new Map<number, string[]>();
  let maxDepth = 0;
  for (const id of ids) {
    const d = depthOf(id);
    maxDepth = Math.max(maxDepth, d);
    (buckets.get(d) ?? buckets.set(d, []).get(d))?.push(id);
  }

  const columns: Column[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const bucket = buckets.get(d);
    if (!bucket) continue;
    columns.push({
      name: `stage:${d}`,
      label: `STAGE ${d + 1}`,
      accent: FLATTEN_ACCENT,
      collapsed: false,
      nodeIds: byMetric(bucket),
    });
  }
  return columns;
}

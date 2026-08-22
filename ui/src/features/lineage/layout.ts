import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import { hotspotColor, statusColor } from "@/lib/colors";
import type { GraphResponse, MetricKey } from "@/types";

// Deterministic layered ("swimlane") layout: one column per layer in the
// canonical order the API returns, nodes stacked within each column. Two opt-in
// refinements keep large graphs readable:
//   • tidy   — barycenter sweeps reorder nodes within each column to minimize
//              edge crossings (untangles the "hairball").
//   • flatten — ignore the semantic layers entirely and derive columns purely
//              from dependency depth (longest path from a root).
// No external layout engine — predictable and fast at dbt-project scale.

export const COLUMN_WIDTH = 320;
export const NODE_WIDTH = 230;
export const ROW_HEIGHT = 46;
const HEADER_Y = 0;
const FIRST_ROW_Y = 70;
const TIDY_SWEEPS = 6;

export interface ModelNodeData {
  label: string;
  layer: string;
  resourceType: string;
  tint: string; // resolved node fill color (heat scale, status, owner, or risk)
  columnLineageStatus: string | null;
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
  tidy?: boolean; // reorder within columns to reduce edge crossings
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

  // Normalize the chosen metric across all nodes for coloring.
  let maxMetric = 0;
  for (const n of graph.nodes) maxMetric = Math.max(maxMetric, n.metrics[metric] ?? 0);
  const norm = (v: number) => (maxMetric > 0 ? v / maxMetric : 0);

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

  // ---- Reduce crossings (barycenter sweeps) --------------------------------
  if (opts.tidy) tidyColumns(columns, slotEdges);

  // ---- Emit React Flow nodes ----------------------------------------------
  const rfNodes: RFNode[] = [];
  columns.forEach((col, colIndex) => {
    const x = colIndex * COLUMN_WIDTH;
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
          columnLineageStatus: n.column_lineage_status,
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

// Barycenter crossing-minimization: repeatedly reorder each column so a node
// sits near the average row of the neighbors it connects to. Sweeps alternate
// direction (left-anchored, then right-anchored) and converge quickly.
function tidyColumns(columns: Column[], edges: { source: string; target: string }[]): void {
  const order = columns.map((c) => (c.collapsed ? [`layer:${c.name}`] : [...c.nodeIds]));
  const colOf = new Map<string, number>();
  order.forEach((slots, ci) => {
    for (const s of slots) colOf.set(s, ci);
  });

  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => (neighbors.get(a) ?? neighbors.set(a, []).get(a))?.push(b);
  for (const e of edges) {
    if (!colOf.has(e.source) || !colOf.has(e.target)) continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const row = new Map<string, number>();
  const setRows = (slots: string[]) => {
    slots.forEach((s, i) => {
      row.set(s, i);
    });
  };
  for (const slots of order) setRows(slots);

  const sweep = (forward: boolean) => {
    const indices = order.map((_, i) => i);
    for (const ci of forward ? indices : indices.reverse()) {
      const slots = order[ci];
      if (slots.length < 2) continue;
      const bary = new Map<string, number>();
      slots.forEach((s, i) => {
        // Anchor to the already-settled side (left on a forward sweep).
        const ns = (neighbors.get(s) ?? []).filter((t) => {
          const tc = colOf.get(t);
          return tc !== undefined && (forward ? tc < ci : tc > ci);
        });
        if (ns.length === 0) {
          bary.set(s, i); // no anchor → keep current position
          return;
        }
        let sum = 0;
        for (const t of ns) sum += row.get(t) ?? 0;
        bary.set(s, sum / ns.length);
      });
      const sorted = slots
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (bary.get(a.s) ?? 0) - (bary.get(b.s) ?? 0) || a.i - b.i)
        .map((x) => x.s);
      order[ci] = sorted;
      setRows(sorted);
    }
  };

  for (let k = 0; k < TIDY_SWEEPS; k++) {
    sweep(true);
    sweep(false);
  }

  columns.forEach((c, ci) => {
    if (!c.collapsed) c.nodeIds = order[ci];
  });
}

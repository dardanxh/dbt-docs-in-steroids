import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { GraphResponse, MetricKey } from "@/types";

// Deterministic layered ("swimlane") layout: one column per layer in the
// canonical order the API returns, nodes stacked within each column sorted so
// hotspots sit on top. No external layout engine — predictable and fast at
// dbt-project scale. (elkjs edge-crossing minimization is a future enhancement.)

export const COLUMN_WIDTH = 320;
export const NODE_WIDTH = 230;
export const ROW_HEIGHT = 46;
const HEADER_Y = 0;
const FIRST_ROW_Y = 70;

export interface ModelNodeData {
  label: string;
  layer: string;
  resourceType: string;
  metricValue: number; // normalized 0..1 for coloring
  columnLineageStatus: string | null;
  dimmed: boolean;
  highlighted: boolean;
  badge?: string; // right-aligned chip (LOC / used·total column fraction / etc.)
  [key: string]: unknown;
}

export interface HeaderNodeData {
  layer: string;
  count: number;
  collapsed: boolean;
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
}

export function computeLayout(graph: GraphResponse, opts: LayoutOptions): LayoutResult {
  const { collapsed, metric } = opts;
  const layerOfNode = new Map<string, string>();
  for (const n of graph.nodes) layerOfNode.set(n.id, n.layer);

  // Normalize the chosen metric across all nodes for coloring.
  let maxMetric = 0;
  for (const n of graph.nodes) maxMetric = Math.max(maxMetric, n.metrics[metric] ?? 0);
  const norm = (v: number) => (maxMetric > 0 ? v / maxMetric : 0);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const highlightNodes = opts.highlightNodes ?? new Set<string>();
  const hasHighlight = highlightNodes.size > 0;
  const focusIds = opts.focusIds ?? null;
  const included = (id: string) => !focusIds || focusIds.has(id);

  const rfNodes: RFNode[] = [];

  // In focus mode, only layers that contain a focused node are shown (and never
  // collapsed), so the isolated subgraph reads cleanly.
  const visibleLayers = graph.layers.filter((layer) => layer.node_ids.some(included));

  // Apply the user's custom column order (drag-to-reorder) when provided.
  const rank = opts.layerOrder ? new Map(opts.layerOrder.map((n, i) => [n, i])) : null;
  const orderedLayers = rank
    ? [...visibleLayers].sort((a, b) => (rank.get(a.name) ?? 999) - (rank.get(b.name) ?? 999))
    : visibleLayers;

  orderedLayers.forEach((layer, colIndex) => {
    const x = colIndex * COLUMN_WIDTH;
    const layerNodeIds = layer.node_ids.filter(included);
    const isCollapsed = !focusIds && collapsed.has(layer.name);

    // Column header (also the collapse toggle target).
    rfNodes.push({
      id: `header:${layer.name}`,
      type: "header",
      position: { x, y: HEADER_Y },
      data: {
        layer: layer.name,
        count: layerNodeIds.length,
        collapsed: isCollapsed,
      } satisfies HeaderNodeData,
      draggable: false,
      selectable: false,
    });

    if (isCollapsed) {
      rfNodes.push({
        id: `layer:${layer.name}`,
        type: "collapsed",
        position: { x, y: FIRST_ROW_Y },
        data: { layer: layer.name, count: layerNodeIds.length, collapsed: true } satisfies HeaderNodeData,
        draggable: false,
      });
      return;
    }

    // Sort nodes within the layer by the chosen metric (hotspots on top).
    const nodes = layerNodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0));

    nodes.forEach((n, rowIndex) => {
      const highlighted = hasHighlight && highlightNodes.has(n.id);
      rfNodes.push({
        id: n.id,
        type: "model",
        position: { x, y: FIRST_ROW_Y + rowIndex * ROW_HEIGHT },
        data: {
          label: n.name,
          layer: n.layer,
          resourceType: n.resource_type,
          metricValue: norm(n.metrics[metric] ?? 0),
          columnLineageStatus: n.column_lineage_status,
          dimmed: hasHighlight && !highlighted,
          highlighted,
          badge: opts.badges?.get(n.id),
        } satisfies ModelNodeData,
        draggable: false,
      });
    });
  });

  // Edges: rewire endpoints in collapsed layers to their layer node; dedupe.
  const edgeSet = new Set<string>();
  const rfEdges: RFEdge[] = [];
  const endpoint = (id: string) => {
    const layer = layerOfNode.get(id);
    return layer && collapsed.has(layer) ? `layer:${layer}` : id;
  };
  for (const e of graph.edges) {
    if (!included(e.src) || !included(e.dst)) continue;
    const s = endpoint(e.src);
    const t = endpoint(e.dst);
    if (s === t) continue;
    const key = `${s}->${t}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    const active = opts.activeEdges?.has(`${e.src}->${e.dst}`) ?? false;
    const dimmed = hasHighlight && !active;
    rfEdges.push({
      id: key,
      source: s,
      target: t,
      className: active ? "active" : dimmed ? "dimmed" : undefined,
      zIndex: active ? 10 : 0,
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}

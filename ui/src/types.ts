// Clean domain types mirroring the backend API responses (see be/app/domain/*).

export interface Project {
  id: string;
  name: string;
  source_type: "path" | "upload";
  source_ref: string | null;
  manifest_hash: string | null;
  status: "pending" | "running" | "ready" | "failed";
  error: string | null;
  ingested_at: string | null;
  stats: Record<string, any> | null;
}

export interface NodeMetrics {
  fan_in: number;
  fan_out: number;
  upstream_count: number;
  downstream_count: number;
  degree_centrality: number;
  betweenness: number;
  hotspot_score: number;
  loc: number;
  complexity: number;
  cohesion: number;
  test_count: number;
  column_count: number;
}

export type MetricKey = keyof NodeMetrics;

export interface GraphNode {
  id: string;
  name: string;
  resource_type: string;
  layer: string;
  materialized: string | null;
  column_lineage_status: string | null;
  metrics: NodeMetrics;
}

export interface Edge {
  src: string;
  dst: string;
}

export interface Layer {
  id: string;
  name: string;
  node_ids: string[];
}

export interface LayerEdge {
  src: string;
  dst: string;
  count: number;
}

export interface GraphResponse {
  layers: Layer[];
  nodes: GraphNode[];
  edges: Edge[];
  layer_edges: LayerEdge[];
  coverage: Record<string, number>;
}

export interface Column {
  name: string;
  data_type: string | null;
  description: string | null;
  tags: string[];
  has_lineage: boolean;
}

export interface NodeDetail {
  id: string;
  name: string;
  resource_type: string;
  layer: string;
  materialized: string | null;
  schema_name: string | null;
  database_name: string | null;
  file_path: string | null;
  description: string | null;
  tags: string[];
  metrics: NodeMetrics;
  columns: Column[];
  parents: string[];
  children: string[];
  column_lineage_status: string | null;
  sql: string | null;
}

export interface ColumnUsageItem {
  node_id: string;
  used: number;
  total: number;
}

export interface ColumnUsage {
  upstream: ColumnUsageItem[];
  downstream: ColumnUsageItem[];
}

export interface ColumnRef {
  node_id: string;
  column: string;
  layer: string;
}

export interface ColumnEdge {
  src: ColumnRef;
  dst: ColumnRef;
  transform: string;
  confidence: string;
}

export interface ColumnLineage {
  root: ColumnRef;
  direction: string;
  columns: ColumnRef[];
  edges: ColumnEdge[];
  source_columns: ColumnRef[];
  partial: boolean;
}

export interface MostUsedModel {
  node_id: string;
  name: string;
  layer: string;
  downstream_count: number;
}

export interface Analytics {
  counts: Record<string, number>;
  by_layer: Record<string, number>;
  column_lineage: Record<string, number>;
  materializations: Record<string, number>;
  node_edges: number;
  column_edges: number;
  most_used: MostUsedModel[];
  dbt_version: string | null;
  adapter: string | null;
}

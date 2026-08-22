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
  // Git ownership (null for upload-mode / non-git projects).
  owner: string | null;
  owner_share: number | null;
  contributor_count: number;
  last_author: string | null;
  last_modified_at: string | null;
}

// Numeric heat metrics only (excludes the git-ownership fields above).
export type MetricKey =
  | "fan_in"
  | "fan_out"
  | "upstream_count"
  | "downstream_count"
  | "degree_centrality"
  | "betweenness"
  | "hotspot_score"
  | "loc"
  | "complexity"
  | "cohesion"
  | "test_count"
  | "column_count";

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

export interface OwnerStat {
  owner: string;
  model_count: number;
  avg_share: number;
}

export interface OwnershipStats {
  tracked: boolean;
  leaderboard: OwnerStat[];
  by_layer: Record<string, Record<string, number>>;
  risk: Record<string, number>; // orphaned / solo / contested / stale / total_models
}

export interface Analytics {
  counts: Record<string, number>;
  by_layer: Record<string, number>;
  column_lineage: Record<string, number>;
  materializations: Record<string, number>;
  node_edges: number;
  column_edges: number;
  most_used: MostUsedModel[];
  ownership: OwnershipStats;
  dbt_version: string | null;
  adapter: string | null;
}

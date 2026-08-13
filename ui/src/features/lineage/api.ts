import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ColumnLineage, GraphResponse, NodeDetail } from "@/types";

export const lineageKeys = {
  graph: (projectId: string) => ["graph", projectId] as const,
  node: (projectId: string, nodeId: string) => ["node", projectId, nodeId] as const,
  columnLineage: (projectId: string, nodeId: string, column: string, direction: string) =>
    ["column-lineage", projectId, nodeId, column, direction] as const,
};

export function useGraph(projectId: string | null) {
  return useQuery({
    queryKey: lineageKeys.graph(projectId ?? ""),
    queryFn: () => apiGet<GraphResponse>(`/projects/${projectId}/graph`),
    enabled: !!projectId,
  });
}

export function useNodeDetail(projectId: string | null, nodeId: string | null) {
  return useQuery({
    queryKey: lineageKeys.node(projectId ?? "", nodeId ?? ""),
    queryFn: () => apiGet<NodeDetail>(`/projects/${projectId}/nodes/${encodeURIComponent(nodeId ?? "")}`),
    enabled: !!projectId && !!nodeId,
  });
}

export function useColumnLineage(
  projectId: string | null,
  nodeId: string | null,
  column: string | null,
  direction: "upstream" | "downstream" | "both",
) {
  return useQuery({
    queryKey: lineageKeys.columnLineage(projectId ?? "", nodeId ?? "", column ?? "", direction),
    queryFn: () =>
      apiGet<ColumnLineage>(
        `/projects/${projectId}/nodes/${encodeURIComponent(nodeId ?? "")}/columns/${encodeURIComponent(
          column ?? "",
        )}/lineage?direction=${direction}`,
      ),
    enabled: !!projectId && !!nodeId && !!column,
  });
}

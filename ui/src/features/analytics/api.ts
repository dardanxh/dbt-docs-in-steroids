import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Analytics, RedundancyResponse } from "@/types";

export function useAnalytics(projectId: string | null) {
  return useQuery({
    queryKey: ["analytics", projectId],
    queryFn: () => apiGet<Analytics>(`/projects/${projectId}/analytics`),
    enabled: !!projectId,
  });
}

export function useRedundancy(projectId: string | null) {
  return useQuery({
    queryKey: ["redundancy", projectId],
    queryFn: () => apiGet<RedundancyResponse>(`/projects/${projectId}/redundancy`),
    enabled: !!projectId,
  });
}

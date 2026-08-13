import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Project } from "@/types";

export const projectKeys = {
  all: ["projects"] as const,
  defaults: ["projects", "defaults"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: projectKeys.all, queryFn: () => apiGet<Project[]>("/projects/") });
}

export function useProjectDefaults() {
  return useQuery({
    queryKey: projectKeys.defaults,
    queryFn: () => apiGet<{ default_path: string | null }>("/projects/defaults"),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; path: string }) => apiPost<Project>("/projects/", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useReingest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => apiPost<Project>(`/projects/${projectId}/ingest`),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => apiDelete(`/projects/${projectId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

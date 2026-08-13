import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiPostForm, extractErrorMessage } from "@/lib/api";
import type { Project } from "@/types";
import { useCreateProject, useDeleteProject, useProjectDefaults, useProjects, useReingest } from "./api";

const STATUS_COLOR: Record<string, string> = {
  ready: "text-emerald-400",
  running: "text-sky-400",
  pending: "text-muted",
  failed: "text-red-400",
};

export function ProjectBar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: projects } = useProjects();
  const { data: defaults } = useProjectDefaults();
  const create = useCreateProject();
  const reingest = useReingest();
  const del = useDeleteProject();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-select the first ready project once loaded.
  useEffect(() => {
    if (!selectedId && projects && projects.length > 0) onSelect(projects[0].id);
  }, [projects, selectedId, onSelect]);

  const selected = projects?.find((p) => p.id === selectedId) ?? null;

  async function registerFromPath() {
    setError(null);
    const path = window.prompt(
      "Path to a dbt project (its target/ holds manifest.json)",
      defaults?.default_path ?? "",
    );
    if (!path) return;
    const name =
      window.prompt("Project name", path.split("/").filter(Boolean).pop() ?? "project") ?? "project";
    try {
      const proj = await create.mutateAsync({ name, path });
      onSelect(proj.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function uploadManifest(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const form = new FormData();
    const manifest = Array.from(files).find((f) => f.name.includes("manifest"));
    const catalog = Array.from(files).find((f) => f.name.includes("catalog"));
    if (!manifest) {
      setError("Select a manifest.json (and optionally catalog.json).");
      return;
    }
    form.append("name", manifest.name.replace(".json", ""));
    form.append("manifest", manifest);
    if (catalog) form.append("catalog", catalog);
    try {
      const proj = await apiPostForm<Project>("/projects/upload", form);
      await qc.invalidateQueries();
      onSelect(proj.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-border bg-panel-2 px-2 py-1.5 text-fg outline-none"
      >
        {(!projects || projects.length === 0) && <option value="">No projects</option>}
        {projects?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {selected && (
        <span className={STATUS_COLOR[selected.status]} title={selected.error ?? ""}>
          ● {selected.status}
        </span>
      )}

      <IconButton title="Register from path" onClick={registerFromPath} loading={create.isPending}>
        <Plus size={14} />
      </IconButton>
      <IconButton title="Upload manifest.json + catalog.json" onClick={() => fileRef.current?.click()}>
        <Upload size={14} />
      </IconButton>
      {selected?.source_type === "path" && (
        <IconButton
          title="Re-ingest from path"
          onClick={() => reingest.mutate(selected.id)}
          loading={reingest.isPending}
        >
          <RefreshCw size={14} />
        </IconButton>
      )}
      {selected && (
        <IconButton
          title="Delete project"
          onClick={() => {
            if (window.confirm(`Delete project "${selected.name}"?`)) del.mutate(selected.id);
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        multiple
        className="hidden"
        onChange={(e) => uploadManifest(e.target.files)}
      />
      {error && (
        <span className="max-w-[280px] truncate text-red-400" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  loading,
  children,
}: {
  title: string;
  onClick: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={loading}
      className="rounded border border-border p-1.5 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-50"
    >
      {children}
    </button>
  );
}

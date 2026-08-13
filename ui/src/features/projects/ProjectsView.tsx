import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { apiPostForm, extractErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import { useCreateProject, useDeleteProject, useProjectDefaults, useProjects, useReingest } from "./api";

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-400",
  running: "bg-sky-500/15 text-sky-400",
  pending: "bg-panel-2 text-muted",
  failed: "bg-red-500/15 text-red-400",
};

export function ProjectsView({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const { data: projects } = useProjects();
  const { data: defaults } = useProjectDefaults();
  const create = useCreateProject();
  const reingest = useReingest();
  const del = useDeleteProject();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const defaultPath = defaults?.default_path ?? "";

  async function register() {
    setError(null);
    const p = path || defaultPath;
    if (!p) {
      setError("Enter a dbt project path.");
      return;
    }
    try {
      const proj = await create.mutateAsync({
        name: name || p.split("/").filter(Boolean).pop() || "project",
        path: p,
      });
      setName("");
      setPath("");
      onOpen(proj.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function upload(files: FileList | null) {
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
      onOpen(proj.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-8">
      <h2 className="mb-6 font-semibold text-fg text-lg">Projects</h2>

      {/* Register */}
      <div className="mb-6 rounded-lg border border-border bg-panel p-4">
        <div className="mb-3 font-medium text-fg text-sm">Register a dbt project</div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className="w-40 rounded border border-border bg-panel-2 px-2 py-1.5 text-fg text-xs outline-none"
            />
          </Field>
          <Field label="Local path (its target/ holds manifest.json)">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={defaultPath || "/path/to/dbt-project"}
              className="w-96 rounded border border-border bg-panel-2 px-2 py-1.5 text-fg text-xs outline-none"
            />
          </Field>
          <button
            type="button"
            onClick={register}
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-white text-xs disabled:opacity-50"
          >
            <FolderPlus size={14} /> {create.isPending ? "Ingesting…" : "Register"}
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-muted text-xs hover:text-fg">
            <Upload size={14} /> Upload artifacts
            <input
              type="file"
              accept="application/json"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
          </label>
        </div>
        {error && <div className="mt-2 text-red-400 text-xs">{error}</div>}
      </div>

      {/* List */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(projects ?? []).map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            active={p.id === activeId}
            onOpen={() => onOpen(p.id)}
            onReingest={() => reingest.mutate(p.id)}
            reingesting={reingest.isPending}
            onDelete={() => {
              if (window.confirm(`Delete project "${p.name}"?`)) del.mutate(p.id);
            }}
          />
        ))}
        {projects && projects.length === 0 && (
          <div className="text-muted text-xs">No projects yet — register one above.</div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  active,
  onOpen,
  onReingest,
  reingesting,
  onDelete,
}: {
  project: Project;
  active: boolean;
  onOpen: () => void;
  onReingest: () => void;
  reingesting: boolean;
  onDelete: () => void;
}) {
  const stats = project.stats ?? {};
  const counts = (stats.counts ?? {}) as Record<string, number>;
  const cl = (stats.column_lineage ?? {}) as Record<string, number>;
  const coverage = cl.total_models ? Math.round((100 * (cl.ok ?? 0)) / cl.total_models) : null;

  return (
    <div className={cn("rounded-lg border bg-panel p-4", active ? "border-accent" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-fg text-sm" title={project.name}>
            {project.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted" title={project.source_ref ?? ""}>
            {project.source_type === "path" ? project.source_ref : "uploaded artifacts"}
          </div>
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", STATUS_STYLE[project.status])}>
          {project.status}
        </span>
      </div>

      {project.error && <div className="mt-2 line-clamp-2 text-[11px] text-red-400">{project.error}</div>}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>{counts.model ?? 0} models</span>
        <span>{counts.source ?? 0} sources</span>
        <span>{counts.test ?? 0} tests</span>
        {coverage !== null && <span>{coverage}% col-lineage</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md bg-panel-2 px-2.5 py-1 text-fg text-xs hover:bg-border"
        >
          Open
        </button>
        {project.source_type === "path" && (
          <button
            type="button"
            onClick={onReingest}
            disabled={reingesting}
            title="Re-ingest from path"
            className="rounded-md border border-border p-1.5 text-muted hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="rounded-md border border-border p-1.5 text-muted hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted">{label}</span>
      {children}
    </div>
  );
}

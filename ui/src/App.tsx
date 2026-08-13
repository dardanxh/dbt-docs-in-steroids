import { useState } from "react";
import { AnalyticsDashboard } from "@/features/analytics/AnalyticsDashboard";
import { Sidebar, type View } from "@/features/app-shell/Sidebar";
import { SidebarSlotProvider } from "@/features/app-shell/sidebar-slot";
import { ThemeToggle } from "@/features/app-shell/ThemeToggle";
import { CommandPalette } from "@/features/command/CommandPalette";
import { LineageView } from "@/features/lineage/LineageView";
import { ProjectBar } from "@/features/projects/ProjectBar";
import { ProjectsView } from "@/features/projects/ProjectsView";
import { QualityView } from "@/features/quality/QualityView";
import { SettingsView } from "@/features/settings/SettingsView";

// Persist active project + view + selected node in the URL so a view is
// shareable/reloadable and node selection works across views.
function useUrlState() {
  const params = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState<string | null>(params.get("project"));
  const [view, setView] = useState<View>((params.get("view") as View) || "lineage");
  const [nodeId, setNodeId] = useState<string | null>(params.get("node"));

  const sync = (p: string | null, v: View, n: string | null) => {
    const q = new URLSearchParams();
    if (p) q.set("project", p);
    q.set("view", v);
    if (n) q.set("node", n);
    window.history.replaceState(null, "", `?${q.toString()}`);
  };
  return {
    projectId,
    view,
    nodeId,
    setProjectId: (p: string) => {
      setProjectId(p);
      sync(p, view, nodeId);
    },
    setView: (v: View) => {
      setView(v);
      sync(projectId, v, nodeId);
    },
    openNode: (n: string) => {
      setNodeId(n);
      setView("lineage");
      sync(projectId, "lineage", n);
    },
  };
}

export function App() {
  const { projectId, view, nodeId, setProjectId, setView, openNode } = useUrlState();

  const openProject = (id: string) => {
    setProjectId(id);
    setView("lineage");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-border border-b bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2 font-semibold text-fg text-sm">
          <span className="text-accent">◈</span> dbt-docs-in-steroids
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ProjectBar selectedId={projectId} onSelect={setProjectId} />
          <ThemeToggle />
        </div>
      </header>

      <SidebarSlotProvider>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            {!projectId && view !== "projects" && view !== "settings" ? (
              <Empty onGoProjects={() => setView("projects")} />
            ) : view === "lineage" && projectId ? (
              <LineageView projectId={projectId} focusNodeId={nodeId} />
            ) : view === "analytics" && projectId ? (
              <AnalyticsDashboard projectId={projectId} />
            ) : view === "quality" && projectId ? (
              <QualityView projectId={projectId} onOpenNode={openNode} />
            ) : view === "projects" ? (
              <ProjectsView activeId={projectId} onOpen={openProject} />
            ) : view === "settings" ? (
              <SettingsView />
            ) : (
              <Empty onGoProjects={() => setView("projects")} />
            )}
          </main>
          <Sidebar view={view} onView={setView} />
        </div>
      </SidebarSlotProvider>

      <CommandPalette projectId={projectId} onOpenNode={openNode} />
    </div>
  );
}

function Empty({ onGoProjects }: { onGoProjects: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <p>No project selected.</p>
      <button
        type="button"
        onClick={onGoProjects}
        className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-fg text-xs hover:bg-panel"
      >
        Go to Projects
      </button>
    </div>
  );
}

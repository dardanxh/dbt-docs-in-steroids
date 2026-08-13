import { GitFork, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { AnalyticsDashboard } from "@/features/analytics/AnalyticsDashboard";
import { LineageView } from "@/features/lineage/LineageView";
import { ProjectBar } from "@/features/projects/ProjectBar";
import { cn } from "@/lib/utils";

type View = "lineage" | "analytics";

// Persist selection in the URL so a view is shareable/reloadable.
function useUrlState() {
  const params = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState<string | null>(params.get("project"));
  const [view, setView] = useState<View>((params.get("view") as View) || "lineage");

  const sync = (p: string | null, v: View) => {
    const q = new URLSearchParams();
    if (p) q.set("project", p);
    q.set("view", v);
    window.history.replaceState(null, "", `?${q.toString()}`);
  };
  return {
    projectId,
    view,
    setProjectId: (p: string) => {
      setProjectId(p);
      sync(p, view);
    },
    setView: (v: View) => {
      setView(v);
      sync(projectId, v);
    },
  };
}

export function App() {
  const { projectId, view, setProjectId, setView } = useUrlState();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-border border-b bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2 font-semibold text-fg text-sm">
          <span className="text-accent">◈</span> dbt-docs-in-steroids
        </div>
        <nav className="flex items-center gap-1">
          <Tab active={view === "lineage"} onClick={() => setView("lineage")} icon={<GitFork size={14} />}>
            Lineage
          </Tab>
          <Tab
            active={view === "analytics"}
            onClick={() => setView("analytics")}
            icon={<LayoutDashboard size={14} />}
          >
            Analytics
          </Tab>
        </nav>
        <div className="ml-auto">
          <ProjectBar selectedId={projectId} onSelect={setProjectId} />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {!projectId ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <p>No project selected.</p>
            <p className="text-xs">
              Register a dbt project from its path or upload its artifacts (top right).
            </p>
          </div>
        ) : view === "lineage" ? (
          <LineageView projectId={projectId} />
        ) : (
          <AnalyticsDashboard projectId={projectId} />
        )}
      </main>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-xs",
        active ? "bg-panel-2 text-fg" : "text-muted hover:text-fg",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

import { BarChart3, ChevronLeft, ChevronRight, FolderGit2, GitFork, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

export type View = "lineage" | "analytics" | "projects" | "settings";

const ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  { view: "lineage", label: "Lineage", icon: <GitFork size={17} /> },
  { view: "analytics", label: "Analytics", icon: <BarChart3 size={17} /> },
  { view: "projects", label: "Projects", icon: <FolderGit2 size={17} /> },
  { view: "settings", label: "Settings", icon: <Settings size={17} /> },
];

export function Sidebar({ view, onView }: { view: View; onView: (v: View) => void }) {
  const { settings, update } = useSettings();
  const expanded = settings.sidebarExpanded;

  return (
    <nav
      className={cn(
        "flex flex-col border-border border-l bg-panel py-2 transition-[width] duration-150",
        expanded ? "w-48" : "w-14",
      )}
    >
      <button
        type="button"
        onClick={() => update({ sidebarExpanded: !expanded })}
        title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="mx-2 mb-1 flex items-center justify-center rounded-md p-2 text-muted hover:bg-panel-2 hover:text-fg"
      >
        {expanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <div className="flex flex-col gap-0.5 px-2">
        {ITEMS.map((item) => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onView(item.view)}
              title={item.label}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 font-medium text-xs",
                active ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
                !expanded && "justify-center",
              )}
            >
              {item.icon}
              {expanded && <span>{item.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

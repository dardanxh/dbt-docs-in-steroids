import { BarChart3, FolderGit2, GitFork, Plug, Settings, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type View = "lineage" | "analytics" | "quality" | "projects" | "api" | "settings";

const ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  { view: "lineage", label: "Lineage", icon: <GitFork size={15} /> },
  { view: "analytics", label: "Analytics", icon: <BarChart3 size={15} /> },
  { view: "quality", label: "Quality", icon: <ShieldCheck size={15} /> },
  { view: "projects", label: "Projects", icon: <FolderGit2 size={15} /> },
  { view: "api", label: "API", icon: <Plug size={15} /> },
  { view: "settings", label: "Settings", icon: <Settings size={15} /> },
];

// Primary navigation: a horizontal menu in the top bar.
export function TopNav({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <nav className="flex items-center gap-0.5">
      {ITEMS.map((item) => {
        const active = view === item.view;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onView(item.view)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium text-xs",
              active ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

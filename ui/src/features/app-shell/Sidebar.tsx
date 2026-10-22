import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useSidebarSlot } from "./sidebar-slot";

// Left sidebar for a view's contextual controls (e.g. the Lineage graph
// toolbar), which portal into the slot below. Collapsible to a thin rail.
export function Sidebar() {
  const { settings, update } = useSettings();
  const { register } = useSidebarSlot();
  const expanded = settings.sidebarExpanded;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-border border-r bg-panel py-2 transition-[width] duration-150",
        expanded ? "w-60" : "w-10",
      )}
    >
      {/* Contextual controls portal in here. */}
      {expanded ? (
        <div ref={register} className="min-h-0 flex-1 overflow-y-auto" />
      ) : (
        <div className="flex-1" />
      )}

      {/* Expand / collapse toggle sits at the bottom of the sidebar. */}
      <button
        type="button"
        onClick={() => update({ sidebarExpanded: !expanded })}
        title={expanded ? "Collapse controls" : "Expand controls"}
        className={cn(
          "mx-1.5 mt-1 flex items-center rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-fg",
          expanded ? "justify-end" : "justify-center",
        )}
      >
        {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </aside>
  );
}

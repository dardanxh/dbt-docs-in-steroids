import { Moon, Sun } from "lucide-react";
import { useSettings } from "@/lib/settings";

/** Quick light/dark flip in the top bar. The 3-way (incl. system) choice lives in Settings. */
export function ThemeToggle() {
  const { resolvedTheme, update } = useSettings();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => update({ theme: isDark ? "light" : "dark" })}
      title={isDark ? "Switch to light" : "Switch to dark"}
      className="rounded-md border border-border p-1.5 text-muted hover:bg-panel-2 hover:text-fg"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

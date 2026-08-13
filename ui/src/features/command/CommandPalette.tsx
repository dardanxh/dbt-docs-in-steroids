import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGraph } from "@/features/lineage/api";
import { layerColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const RESULT_LIMIT = 60;

/** Cmd/Ctrl-K global search over all models/sources/seeds. Enter opens the node
 * in the Lineage view. */
export function CommandPalette({
  projectId,
  onOpenNode,
}: {
  projectId: string | null;
  onOpenNode: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: graph } = useGraph(projectId);

  // Global Cmd/Ctrl-K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    const rows = graph.nodes;
    const matched = q
      ? rows.filter((n) => n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      : rows;
    // Rank: name-prefix match first, then by downstream usage.
    return [...matched]
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || b.metrics.downstream_count - a.metrics.downstream_count;
      })
      .slice(0, RESULT_LIMIT);
  }, [graph, query]);

  if (!open) return null;

  const choose = (id: string) => {
    onOpenNode(id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      choose(results[active].id);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-40 cursor-default bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div className="-translate-x-1/2 fixed top-24 left-1/2 z-50 w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-border border-b px-3 py-2.5">
          <Search size={15} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search models, sources, seeds…"
            className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && <li className="px-3 py-6 text-center text-muted text-xs">No matches</li>}
          {results.map((n, i) => (
            <li key={n.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(n.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  i === active ? "bg-panel-2" : "",
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: layerColor(n.layer) }} />
                <span className="truncate font-medium text-fg">{n.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">
                  {n.layer} · {n.resource_type}
                </span>
                {i === active && <CornerDownLeft size={12} className="shrink-0 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

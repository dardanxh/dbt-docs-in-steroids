import { useMemo, useState } from "react";
import { useGraph } from "@/features/lineage/api";
import { layerColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { GraphNode } from "@/types";

type SortKey = "name" | "layer" | "loc" | "complexity" | "cohesion" | "test_count" | "column_count";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Model", numeric: false },
  { key: "layer", label: "Layer", numeric: false },
  { key: "loc", label: "LOC", numeric: true },
  { key: "complexity", label: "Complexity", numeric: true },
  { key: "cohesion", label: "Cohesion", numeric: true },
  { key: "test_count", label: "Tests", numeric: true },
  { key: "column_count", label: "Cols", numeric: true },
];

export function QualityView({
  projectId,
  onOpenNode,
}: {
  projectId: string;
  onOpenNode: (id: string) => void;
}) {
  const { data: graph, isPending } = useGraph(projectId);
  const [sort, setSort] = useState<SortKey>("complexity");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [onlyUntested, setOnlyUntested] = useState(false);

  const models = useMemo(() => {
    if (!graph) return [];
    let rows = graph.nodes.filter((n) => n.resource_type === "model");
    if (onlyUntested) rows = rows.filter((n) => n.metrics.test_count === 0);
    const val = (n: GraphNode) => (sort === "name" ? n.name : sort === "layer" ? n.layer : n.metrics[sort]);
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const cmp =
        typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [graph, sort, dir, onlyUntested]);

  if (isPending) return <div className="p-8 text-muted">Loading…</div>;

  const untested = models.filter((m) => m.metrics.test_count === 0).length;

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" || k === "layer" ? "asc" : "desc");
    }
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-8">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-semibold text-fg text-lg">Quality</h2>
        <span className="text-muted text-xs">Heuristic SQL metrics — click a row to open it in Lineage.</span>
      </div>

      <div className="mb-3 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={onlyUntested} onChange={(e) => setOnlyUntested(e.target.checked)} />
          Only untested
        </label>
        <span className="text-muted">
          {models.length} models · <span className="text-amber-400">{untested} without tests</span>
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-panel-2 text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn("px-3 py-2 font-medium", c.numeric ? "text-right" : "text-left")}
                >
                  <button type="button" onClick={() => toggleSort(c.key)} className="hover:text-fg">
                    {c.label}
                    {sort === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr
                key={m.id}
                onClick={() => onOpenNode(m.id)}
                className="cursor-pointer border-border border-t hover:bg-panel-2"
              >
                <td className="max-w-xs truncate px-3 py-1.5 text-fg" title={m.id}>
                  {m.name}
                </td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="h-2 w-2 rounded-sm" style={{ background: layerColor(m.layer) }} />
                    {m.layer}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right text-muted">{m.metrics.loc}</td>
                <td className="px-3 py-1.5 text-right text-muted">{Math.round(m.metrics.complexity)}</td>
                <td className="px-3 py-1.5 text-right text-muted">{m.metrics.cohesion.toFixed(2)}</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right",
                    m.metrics.test_count === 0 ? "text-amber-400" : "text-muted",
                  )}
                >
                  {m.metrics.test_count}
                </td>
                <td className="px-3 py-1.5 text-right text-muted">{m.metrics.column_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

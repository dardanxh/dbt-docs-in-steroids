import { Crosshair, X } from "lucide-react";
import { useState } from "react";
import { apiGet } from "@/lib/api";
import { layerColor, TRANSFORM_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { ColumnLineage, NodeDetail } from "@/types";
import { useNodeDetail } from "./api";

type Direction = "upstream" | "downstream" | "both";

export function NodePanel({
  projectId,
  nodeId,
  onClose,
  onTrace,
  onSelectNode,
  onFocus,
  isFocused,
}: {
  projectId: string;
  nodeId: string;
  onClose: () => void;
  onTrace: (lineage: ColumnLineage, rootColumn: string) => void;
  onSelectNode: (id: string) => void;
  onFocus: (id: string) => void;
  isFocused: boolean;
}) {
  const { data: node, isPending } = useNodeDetail(projectId, nodeId);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("upstream");

  async function trace(column: string, dir: Direction) {
    setActiveColumn(column);
    setDirection(dir);
    const lineage = await apiGet<ColumnLineage>(
      `/projects/${projectId}/nodes/${encodeURIComponent(nodeId)}/columns/${encodeURIComponent(
        column,
      )}/lineage?direction=${dir}`,
    );
    onTrace(lineage, `${node?.name ?? ""}.${column}`);
  }

  return (
    <aside className="absolute top-0 right-0 z-20 flex h-full w-[380px] flex-col border-border border-l bg-panel/98 shadow-2xl backdrop-blur">
      <header className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="min-w-0">
          {node && (
            <>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: layerColor(node.layer) }} />
                <span className="truncate font-semibold text-fg text-sm" title={node.name}>
                  {node.name}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {node.layer} · {node.resource_type}
                {node.materialized ? ` · ${node.materialized}` : ""}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onFocus(nodeId)}
            title="Focus — isolate this model's lineage"
            className={cn(
              "rounded p-1 hover:bg-panel-2",
              isFocused ? "text-sky-400" : "text-muted hover:text-fg",
            )}
          >
            <Crosshair size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {isPending || !node ? (
        <div className="p-4 text-muted text-xs">Loading…</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Metrics node={node} />
          {node.description && (
            <p className="border-border border-b px-4 py-3 text-muted text-xs leading-relaxed">
              {node.description}
            </p>
          )}
          <Relations title="Upstream" ids={node.parents} onSelect={onSelectNode} />
          <Relations title="Downstream" ids={node.children} onSelect={onSelectNode} />

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-fg text-xs">Columns ({node.columns.length})</span>
              <div className="flex gap-1 text-[10px]">
                {(["upstream", "downstream", "both"] as Direction[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => activeColumn && trace(activeColumn, d)}
                    className={cn(
                      "rounded border border-border px-1.5 py-0.5",
                      direction === d ? "bg-panel-2 text-fg" : "text-muted",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <ul className="space-y-0.5">
              {node.columns.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    disabled={!c.has_lineage}
                    onClick={() => trace(c.name, direction)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs",
                      activeColumn === c.name ? "bg-sky-500/15 ring-1 ring-sky-500/40" : "hover:bg-panel-2",
                      !c.has_lineage && "opacity-50",
                    )}
                    title={c.has_lineage ? "Trace this column" : "No column lineage available"}
                  >
                    <span className="truncate font-medium text-fg">{c.name}</span>
                    {c.data_type && (
                      <span className="ml-auto shrink-0 text-[10px] text-muted">{c.data_type}</span>
                    )}
                    {c.has_lineage && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <TransformLegend />
        </div>
      )}
    </aside>
  );
}

function Metrics({ node }: { node: NodeDetail }) {
  const m = node.metrics;
  const items = [
    ["Downstream", m.downstream_count],
    ["Upstream", m.upstream_count],
    ["Direct in", m.fan_in],
    ["Direct out", m.fan_out],
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-px border-border border-b bg-border/30">
      {items.map(([label, val]) => (
        <div key={label} className="bg-panel px-2 py-2 text-center">
          <div className="font-semibold text-fg text-sm">{val}</div>
          <div className="text-[10px] text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}

function Relations({
  title,
  ids,
  onSelect,
}: {
  title: string;
  ids: string[];
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="border-border border-b px-4 py-2">
      <div className="mb-1 text-[11px] text-muted">
        {title} ({ids.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="max-w-full truncate rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
            title={id}
          >
            {id.split(".").slice(-1)[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

function TransformLegend() {
  return (
    <div className="flex flex-wrap gap-3 px-4 py-3 text-[10px] text-muted">
      {Object.entries(TRANSFORM_COLORS).map(([name, color]) => (
        <span key={name} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {name}
        </span>
      ))}
    </div>
  );
}

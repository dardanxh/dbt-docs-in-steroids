import { Handle, type NodeProps, Position } from "@xyflow/react";
import { hotspotColor, layerColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./layout";

const STATUS_DOT: Record<string, string> = {
  ok: "#34d399",
  partial: "#fbbf24",
  failed: "#6b7280",
};

export function ModelNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string;
    layer: string;
    resourceType: string;
    metricValue: number;
    columnLineageStatus: string | null;
    dimmed: boolean;
    highlighted: boolean;
  };
  const accent = layerColor(d.layer);
  const heat = hotspotColor(d.metricValue);
  return (
    <div
      style={{
        width: NODE_WIDTH,
        borderLeftColor: accent,
        background: `color-mix(in srgb, ${heat} 22%, var(--color-panel))`,
      }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border border-l-4 px-2.5 py-1.5 text-xs shadow-sm transition-opacity",
        selected && "ring-2 ring-accent",
        d.highlighted && "ring-2 ring-sky-400",
        d.dimmed ? "opacity-25" : "opacity-100",
      )}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent, width: 6, height: 6 }} />
      {d.resourceType === "source" ? (
        <span title="source" className="text-[10px]">
          🗄️
        </span>
      ) : d.resourceType === "seed" ? (
        <span title="seed" className="text-[10px]">
          🌱
        </span>
      ) : null}
      <span className="truncate font-medium text-fg" title={d.label}>
        {d.label}
      </span>
      {d.columnLineageStatus && (
        <span
          className="ml-auto h-2 w-2 shrink-0 rounded-full"
          title={`column lineage: ${d.columnLineageStatus}`}
          style={{ background: STATUS_DOT[d.columnLineageStatus] ?? "#6b7280" }}
        />
      )}
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 6, height: 6 }} />
    </div>
  );
}

export function HeaderNode({ data }: NodeProps) {
  const d = data as { layer: string; count: number; collapsed: boolean };
  const accent = layerColor(d.layer);
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1 font-semibold text-xs uppercase tracking-wide"
      style={{ color: accent }}
    >
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
      {d.layer}
      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted normal-case">{d.count}</span>
      <span className="text-[10px] text-muted normal-case">{d.collapsed ? "▶ expand" : "▼ collapse"}</span>
    </div>
  );
}

export function CollapsedNode({ data }: NodeProps) {
  const d = data as { layer: string; count: number };
  const accent = layerColor(d.layer);
  return (
    <div
      style={{ width: NODE_WIDTH, borderColor: accent }}
      className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-panel px-3 py-4 text-xs text-muted"
    >
      <Handle type="target" position={Position.Left} style={{ background: accent }} />
      <span className="font-medium" style={{ color: accent }}>
        {d.layer}
      </span>
      <span className="text-muted">· {d.count} nodes collapsed</span>
      <Handle type="source" position={Position.Right} style={{ background: accent }} />
    </div>
  );
}

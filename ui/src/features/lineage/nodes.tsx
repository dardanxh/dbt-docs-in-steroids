import { Handle, type NodeProps, Position } from "@xyflow/react";
import { layerColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { NODE_WIDTH } from "./layout";

export function ModelNode({ data, selected }: NodeProps) {
  const d = data as {
    label: string;
    layer: string;
    resourceType: string;
    tint: string;
    dimmed: boolean;
    highlighted: boolean;
    connected: boolean;
    badge?: string;
    fullName?: boolean;
  };
  // The strip + handles follow the active "Color by" quality, and the card gets a
  // light wash of the same color (the layer is shown by the column header).
  const accent = d.tint;
  return (
    <div
      style={{
        // Full-names mode grows the node to its content; otherwise fixed width + truncate.
        width: d.fullName ? "max-content" : NODE_WIDTH,
        maxWidth: d.fullName ? 620 : undefined,
        borderLeftColor: accent,
        background: `color-mix(in srgb, ${d.tint} 22%, var(--color-panel))`,
      }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border border-l-4 px-2.5 py-1.5 text-xs shadow-sm transition-opacity",
        selected && "ring-2 ring-accent",
        d.connected ? "ring-2 ring-emerald-400" : d.highlighted && "ring-2 ring-sky-400",
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
      <span
        className={cn("font-medium text-fg", d.fullName ? "whitespace-nowrap" : "min-w-0 flex-1 truncate")}
        title={d.label}
      >
        {d.label}
      </span>
      {d.badge && (
        <span className="shrink-0 rounded bg-panel-2 px-1 py-0.5 font-mono text-[10px] text-muted">
          {d.badge}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 6, height: 6 }} />
    </div>
  );
}

export function HeaderNode({ data }: NodeProps) {
  const d = data as { layer: string; count: number; collapsed: boolean; label?: string; accent?: string };
  const accent = d.accent ?? layerColor(d.layer);
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1 font-semibold text-xs uppercase tracking-wide"
      style={{ color: accent }}
    >
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
      {d.label ?? d.layer}
      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted normal-case">{d.count}</span>
      <span className="text-[10px] text-muted normal-case">{d.collapsed ? "▶ expand" : "▼ collapse"}</span>
    </div>
  );
}

export function CollapsedNode({ data }: NodeProps) {
  const d = data as { layer: string; count: number; label?: string; accent?: string };
  const accent = d.accent ?? layerColor(d.layer);
  return (
    <div
      style={{ width: NODE_WIDTH, borderColor: accent }}
      className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-panel px-3 py-4 text-xs text-muted"
    >
      <Handle type="target" position={Position.Left} style={{ background: accent }} />
      <span className="font-medium" style={{ color: accent }}>
        {d.label ?? d.layer}
      </span>
      <span className="text-muted">· {d.count} nodes collapsed</span>
      <Handle type="source" position={Position.Right} style={{ background: accent }} />
    </div>
  );
}

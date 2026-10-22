import { ArrowLeftRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGraph } from "@/features/lineage/api";
import { layerColor } from "@/lib/colors";
import { useThemeTokens } from "@/lib/settings";
import type { GraphNode, MetricKey } from "@/types";

const QUALITIES: { key: MetricKey; label: string }[] = [
  { key: "commit_count", label: "Commit count (churn)" },
  { key: "days_since_change", label: "Days since last change" },
  { key: "doc_coverage", label: "Documentation coverage" },
  { key: "unused_column_count", label: "Unused columns" },
  { key: "complexity", label: "SQL complexity" },
  { key: "loc", label: "Lines of code" },
  { key: "test_count", label: "Test count" },
  { key: "cohesion", label: "Cohesion" },
  { key: "column_count", label: "Column count" },
  { key: "downstream_count", label: "Downstream users" },
  { key: "upstream_count", label: "Upstream depth" },
  { key: "fan_in", label: "Direct inputs" },
  { key: "fan_out", label: "Direct dependents" },
  { key: "hotspot_score", label: "Hotspot score" },
  { key: "betweenness", label: "Betweenness centrality" },
  { key: "degree_centrality", label: "Degree centrality" },
];

const TOOLTIP_EXTRAS: MetricKey[] = ["commit_count", "complexity", "loc", "test_count", "downstream_count"];

const labelOf = (k: MetricKey) => QUALITIES.find((q) => q.key === k)?.label ?? k;

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// 75th percentile — the dashed guides split the plot so the top-right corner
// holds the models high on both qualities.
function p75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(0.75 * (sorted.length - 1))];
}

interface Point {
  x: number;
  y: number;
  node: GraphNode;
}

// Scatter of every model on two user-picked qualities (e.g. churn vs
// complexity). Hover a dot for the model's details; click to open it in Lineage.
export function QualityScatter({
  projectId,
  onOpenNode,
}: {
  projectId: string;
  onOpenNode: (id: string) => void;
}) {
  const { data: graph } = useGraph(projectId);
  const tokens = useThemeTokens();
  const [xKey, setXKey] = useState<MetricKey>("commit_count");
  const [yKey, setYKey] = useState<MetricKey>("complexity");

  const points = useMemo<Point[]>(
    () =>
      (graph?.nodes ?? [])
        .filter((n) => n.resource_type === "model")
        .map((n) => ({ x: n.metrics[xKey], y: n.metrics[yKey], node: n })),
    [graph, xKey, yKey],
  );
  const xGuide = useMemo(() => p75(points.map((p) => p.x)), [points]);
  const yGuide = useMemo(() => p75(points.map((p) => p.y)), [points]);
  const hotspots = points.filter((p) => p.x > xGuide && p.y > yGuide).length;

  if (!graph) return <div className="text-muted text-xs">Loading…</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AxisSelect label="X" value={xKey} onChange={setXKey} />
        <button
          type="button"
          onClick={() => {
            setXKey(yKey);
            setYKey(xKey);
          }}
          title="Swap axes"
          className="rounded border border-border p-1.5 text-muted hover:text-fg"
        >
          <ArrowLeftRight size={13} />
        </button>
        <AxisSelect label="Y" value={yKey} onChange={setYKey} />
        <span className="ml-auto text-[11px] text-muted">
          {points.length} models · <span className="text-fg">{hotspots}</span> in the top 25% on both
        </span>
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 4 }}>
          <CartesianGrid stroke={tokens.border} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            name={labelOf(xKey)}
            tick={{ fill: tokens.muted, fontSize: 11 }}
            label={{
              value: labelOf(xKey),
              position: "insideBottom",
              offset: -14,
              fill: tokens.muted,
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={labelOf(yKey)}
            tick={{ fill: tokens.muted, fontSize: 11 }}
            label={{
              value: labelOf(yKey),
              angle: -90,
              position: "insideLeft",
              fill: tokens.muted,
              fontSize: 11,
            }}
          />
          <ReferenceLine x={xGuide} stroke={tokens.muted} strokeDasharray="4 4" strokeOpacity={0.6} />
          <ReferenceLine y={yGuide} stroke={tokens.muted} strokeDasharray="4 4" strokeOpacity={0.6} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: tokens.muted }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <PointTooltip point={payload[0].payload as Point} xKey={xKey} yKey={yKey} />
              ) : null
            }
          />
          <Scatter
            data={points}
            onClick={(p: { payload?: Point }) => p.payload && onOpenNode(p.payload.node.id)}
            className="cursor-pointer"
          >
            {points.map((p) => (
              <Cell key={p.node.id} fill={layerColor(p.node.layer)} fillOpacity={0.75} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {[...new Set(points.map((p) => p.node.layer))].map((layer) => (
          <span key={layer} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: layerColor(layer) }} />
            {layer}
          </span>
        ))}
        <span className="ml-auto">Dashed lines = 75th percentile · click a dot to open it in Lineage</span>
      </div>
    </div>
  );
}

function AxisSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MetricKey;
  onChange: (k: MetricKey) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MetricKey)}
        className="rounded border border-border bg-panel-2 px-2 py-1 text-fg outline-none"
      >
        {QUALITIES.map((q) => (
          <option key={q.key} value={q.key}>
            {q.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PointTooltip({ point, xKey, yKey }: { point: Point; xKey: MetricKey; yKey: MetricKey }) {
  const { node } = point;
  const m = node.metrics;
  // Always show a few context metrics, minus whichever are already on an axis.
  const extra = TOOLTIP_EXTRAS.filter((k) => k !== xKey && k !== yKey);
  return (
    <div className="max-w-72 rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: layerColor(node.layer) }} />
        <span className="truncate font-semibold text-fg">{node.name}</span>
      </div>
      <div className="mb-1.5 text-[11px] text-muted">
        {node.layer}
        {node.materialized && ` · ${node.materialized}`}
        {m.owner && ` · ${m.owner}`}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        <Row k={labelOf(xKey)} v={fmt(point.x)} strong />
        <Row k={labelOf(yKey)} v={fmt(point.y)} strong />
        {extra.map((k) => (
          <Row key={k} k={labelOf(k)} v={fmt(m[k])} />
        ))}
      </dl>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "text-fg" : "text-muted"}>{k}</dt>
      <dd
        className={
          strong ? "text-right font-semibold text-fg tabular-nums" : "text-right text-muted tabular-nums"
        }
      >
        {v}
      </dd>
    </>
  );
}

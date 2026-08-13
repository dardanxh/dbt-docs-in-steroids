import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { layerColor } from "@/lib/colors";
import { useThemeTokens } from "@/lib/settings";
import type { Analytics } from "@/types";
import { useAnalytics } from "./api";

const CHART_COLORS = ["#818cf8", "#38bdf8", "#f472b6", "#34d399", "#fbbf24", "#94a3b8"];

export function AnalyticsDashboard({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useAnalytics(projectId);
  const tokens = useThemeTokens();
  const tickFill = tokens.muted;
  const tooltipStyle = {
    background: tokens.panel,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    fontSize: 12,
    color: tokens.fg,
  };
  if (isPending) return <div className="p-8 text-muted">Loading analytics…</div>;
  if (error || !data) return <div className="p-8 text-muted">Failed to load analytics.</div>;

  const cl = data.column_lineage;
  const clTotal = cl.total_models || 1;
  const layerData = Object.entries(data.by_layer)
    .filter(([layer]) => layer !== "source")
    .map(([layer, count]) => ({ layer, count }));
  const matzData = Object.entries(data.materializations).map(([name, value]) => ({ name, value }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-baseline gap-3">
        <h2 className="font-semibold text-fg text-lg">Analytics</h2>
        <span className="text-muted text-xs">
          dbt {data.dbt_version} · {data.adapter}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Models" value={data.counts.model ?? 0} />
        <Stat label="Sources" value={data.counts.source ?? 0} />
        <Stat label="Seeds" value={data.counts.seed ?? 0} />
        <Stat label="Tests" value={data.counts.test ?? 0} />
        <Stat label="Macros" value={data.counts.macro ?? 0} />
        <Stat label="Column edges" value={data.column_edges} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Models per layer">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={layerData} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
              <XAxis dataKey="layer" tick={{ fill: tickFill, fontSize: 11 }} />
              <YAxis tick={{ fill: tickFill, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: tokens.muted, fillOpacity: 0.12 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {layerData.map((d) => (
                  <Cell key={d.layer} fill={layerColor(d.layer)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Materializations">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={matzData} dataKey="value" nameKey="name" outerRadius={90} label>
                {matzData.map((d, i) => (
                  <Cell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Column-lineage coverage">
          <CoverageBar label="Resolved" value={cl.ok ?? 0} total={clTotal} color="#34d399" />
          <CoverageBar label="Partial" value={cl.partial ?? 0} total={clTotal} color="#fbbf24" />
          <CoverageBar label="None" value={cl.failed ?? 0} total={clTotal} color="#4b5563" />
          <p className="mt-3 text-[11px] text-muted leading-relaxed">
            Uncovered models use macros/vars our lightweight renderer can't resolve. Provide compiled
            artifacts (<code>dbt compile</code>) to push coverage toward 100%.
          </p>
        </Card>

        <Card title="Most-used models (downstream)">
          <MostUsed data={data} />
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="font-semibold text-2xl text-fg">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <h3 className="mb-3 font-medium text-fg text-sm">{title}</h3>
      {children}
    </div>
  );
}

function CoverageBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = Math.round((value / total) * 100);
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span>
          {value} ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-panel-2">
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function MostUsed({ data }: { data: Analytics }) {
  return (
    <ul className="space-y-1">
      {data.most_used.slice(0, 10).map((m) => (
        <li key={m.node_id} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-sm" style={{ background: layerColor(m.layer) }} />
          <span className="truncate text-fg" title={m.node_id}>
            {m.name}
          </span>
          <span className="ml-auto font-medium text-muted">{m.downstream_count}</span>
        </li>
      ))}
    </ul>
  );
}

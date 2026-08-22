import { Check, Code2, Copy, Crosshair, X } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { type ReactNode, useState } from "react";
import { apiGet } from "@/lib/api";
import { errorCategoryColor, isStale, layerColor, ownerColor, TRANSFORM_COLORS } from "@/lib/colors";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { ColumnLineage, ModelError, NodeDetail } from "@/types";
import { useNodeDetail, useNodeErrors } from "./api";

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
  const { data: errors } = useNodeErrors(projectId, nodeId);
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
          <ErrorTimeline errors={errors ?? []} />
          <Ownership node={node} />
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

          {node.sql && <CodeSection sql={node.sql} />}
          <TransformLegend />
        </div>
      )}
    </aside>
  );
}

function CodeSection({ sql }: { sql: string }) {
  const { resolvedTheme } = useSettings();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const theme = resolvedTheme === "dark" ? themes.vsDark : themes.vsLight;

  const copy = () => {
    navigator.clipboard?.writeText(sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="border-border border-t">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 font-semibold text-fg text-xs"
        >
          <Code2 size={13} /> SQL {open ? "▾" : "▸"}
        </button>
        {open && (
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-fg"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : "copy"}
          </button>
        )}
      </div>
      {open && (
        <Highlight code={sql.trim()} language="sql" theme={theme}>
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className="max-h-96 overflow-auto px-4 pb-3 text-[11px] leading-relaxed"
              style={{ ...style, background: "transparent" }}
            >
              {tokens.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: token lines are positional
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      )}
    </div>
  );
}

function Metrics({ node }: { node: NodeDetail }) {
  const m = node.metrics;
  const lineage: [string, number, string][] = [
    ["Downstream", m.downstream_count, "Transitive dependents"],
    ["Upstream", m.upstream_count, "Transitive ancestors"],
    ["Direct in", m.fan_in, "Direct inputs"],
    ["Direct out", m.fan_out, "Direct dependents"],
  ];
  const quality: [string, number | string, string][] = [
    ["LOC", m.loc, "Non-blank lines of SQL"],
    ["Complexity", Math.round(m.complexity), "Heuristic: weighted joins/CTEs/subqueries/windows/CASE"],
    ["Cohesion", m.cohesion.toFixed(2), "Heuristic: 1 / number of upstream sources (higher = more cohesive)"],
    ["Tests", m.test_count, "Tests referencing this model"],
  ];
  return (
    <div className="border-border border-b">
      <Grid items={lineage} />
      <Grid items={quality} />
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return "";
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Operational-error timeline: every uploaded failure for this model, newest →
// oldest, scrollable. Each row is category + when + message. Hidden when none.
function ErrorTimeline({ errors }: { errors: ModelError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="border-border border-b px-4 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-fg">Errors</span>
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">{errors.length}</span>
      </div>
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
        {errors.map((e) => (
          <li
            key={e.id}
            className="border-border/60 border-l-2 pl-2"
            style={{ borderColor: errorCategoryColor(e.category) }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: `${errorCategoryColor(e.category)}26`,
                  color: errorCategoryColor(e.category),
                }}
              >
                {e.category}
              </span>
              <span className="shrink-0 text-[10px] text-muted" title={e.occurred_at}>
                {relativeTime(e.occurred_at)}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 text-[11px] text-muted leading-snug" title={e.message}>
              {e.message}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Git ownership: top contributor + share, contested/solo/stale badges, and who
// last touched the model. Hidden when the project has no git ownership data.
function Ownership({ node }: { node: NodeDetail }) {
  const m = node.metrics;
  if (!m.owner) return null;
  const share = m.owner_share != null ? Math.round(m.owner_share * 100) : null;
  const solo = m.contributor_count <= 1;
  const contested = m.owner_share != null && m.owner_share < 0.5;
  const stale = isStale(m.last_modified_at);
  return (
    <div className="border-border border-b px-4 py-3 text-xs">
      <div className="mb-2 font-semibold text-fg">Ownership</div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ownerColor(m.owner) }} />
        <span className="min-w-0 flex-1 truncate font-medium text-fg" title={m.owner}>
          {m.owner}
        </span>
        {share != null && <span className="shrink-0 text-muted">owns {share}%</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="text-muted">
          {m.contributor_count} contributor{m.contributor_count === 1 ? "" : "s"}
        </span>
        {solo ? <Badge tone="amber">solo owner</Badge> : contested && <Badge tone="slate">contested</Badge>}
        {stale && <Badge tone="amber">stale</Badge>}
      </div>
      {m.last_author && m.last_modified_at && (
        <div className="mt-1.5 text-[11px] text-muted">
          Last touched by <span className="text-fg">{m.last_author}</span> ·{" "}
          {relativeTime(m.last_modified_at)}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "amber" | "slate"; children: ReactNode }) {
  const cls = tone === "amber" ? "bg-amber-500/15 text-amber-400" : "bg-panel-2 text-muted";
  return <span className={cn("rounded px-1.5 py-0.5", cls)}>{children}</span>;
}

function Grid({ items }: { items: [string, number | string, string][] }) {
  return (
    <div className="grid grid-cols-4 gap-px bg-border/30">
      {items.map(([label, val, hint]) => (
        <div key={label} className="bg-panel px-2 py-2 text-center" title={hint}>
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

import { layerColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { NodeRef, RedundancyPair } from "@/types";
import { useRedundancy } from "./api";

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

// Pairs of models that look like they do the same job — candidates to merge
// into one reusable model. Scored deterministically on the backend from shared
// direct inputs, shared output columns and SQL similarity.
export function RedundancyCandidates({
  projectId,
  onOpenNode,
}: {
  projectId: string;
  onOpenNode: (id: string) => void;
}) {
  const { data, isPending, error } = useRedundancy(projectId);
  if (isPending) return <div className="text-muted text-xs">Loading…</div>;
  if (error || !data) return <div className="text-muted text-xs">Failed to load redundancy candidates.</div>;

  const w = data.weights;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-[11px] text-muted leading-relaxed">
        Pairs that read the same inputs, produce the same columns and have similar SQL. Score ={" "}
        {Math.round((w.inputs ?? 0) * 100)}% shared inputs + {Math.round((w.columns ?? 0) * 100)}% shared
        columns + {Math.round((w.sql ?? 0) * 100)}% SQL similarity (signals a model lacks are left out). Only
        pairs sharing at least one input are compared; shown from 50%.
      </p>
      {data.pairs.length === 0 ? (
        <span className="text-muted">No candidates above 50%.</span>
      ) : (
        <table className="w-full">
          <thead className="text-left text-[10px] text-muted uppercase tracking-wide">
            <tr>
              <th className="py-1 pr-3 font-medium">Score</th>
              <th className="py-1 pr-3 font-medium">Models</th>
              <th className="py-1 pr-3 text-right font-medium">Inputs</th>
              <th className="py-1 pr-3 text-right font-medium">Columns</th>
              <th className="py-1 text-right font-medium">SQL</th>
            </tr>
          </thead>
          <tbody>
            {data.pairs.map((p) => (
              <Row key={`${p.a.id}|${p.b.id}`} pair={p} onOpenNode={onOpenNode} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ pair: p, onOpenNode }: { pair: RedundancyPair; onOpenNode: (id: string) => void }) {
  return (
    <tr className="border-border border-t align-top">
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 overflow-hidden rounded bg-panel-2">
            <div className="h-full rounded bg-accent" style={{ width: pct(p.score) }} />
          </div>
          <span className="font-semibold text-fg tabular-nums">{pct(p.score)}</span>
        </div>
      </td>
      <td className="py-1.5 pr-3">
        <div className="flex flex-col gap-0.5">
          <ModelLink node={p.a} onOpenNode={onOpenNode} />
          <ModelLink node={p.b} onOpenNode={onOpenNode} />
          {p.direct_link && <span className="text-[10px] text-amber-400">one reads the other</span>}
        </div>
      </td>
      <Cell value={p.input_overlap} hint={`${p.shared_inputs} shared input(s)`} />
      <Cell value={p.column_overlap} hint={`${p.shared_columns} shared column(s)`} />
      <Cell value={p.sql_similarity} hint="SQL token overlap" last />
    </tr>
  );
}

function ModelLink({ node, onOpenNode }: { node: NodeRef; onOpenNode: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenNode(node.id)}
      title={`Open ${node.name} in Lineage`}
      className="flex items-center gap-1.5 text-left text-fg hover:text-accent"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: layerColor(node.layer) }} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function Cell({ value, hint, last }: { value: number | null; hint: string; last?: boolean }) {
  return (
    <td className={cn("py-1.5 text-right text-muted tabular-nums", !last && "pr-3")} title={hint}>
      {pct(value)}
    </td>
  );
}

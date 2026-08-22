import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ERROR_CATEGORY_COLORS } from "@/lib/colors";

// Documentation for the INBOUND ("feed data in") APIs that external systems call
// to push data into the app. Read/UI endpoints are intentionally omitted — this
// page is only for integrators feeding the app, not for internal consumption.

// Human-readable descriptions for each error category (mirrors the backend
// ErrorCategory enum; keys come from ERROR_CATEGORY_COLORS so they stay in sync).
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  test_failure: "a dbt test assertion failed (not_null / unique / relationships / accepted_values / custom)",
  compilation_error: "Jinja/SQL compile error — ref/source/macro/var resolution or template syntax",
  sql_runtime_error: "warehouse execution error at runtime (type mismatch, divide-by-zero, invalid function)",
  freshness_error: "source freshness check failed / stale source",
  upstream_failure: "skipped or failed because an upstream model failed (cascade)",
  permission_error: "auth / insufficient privileges / access denied",
  resource_limit: "timeout, out-of-memory, quota / slot exceeded, warehouse suspended",
  dependency_missing: "relation or column not found, schema drift (“… does not exist”)",
  connection_error: "warehouse / network / infra connection failure, Airflow worker died",
  configuration_error: "bad model config, missing target/profile, invalid materialization",
  other: "uncategorized",
};

const EXAMPLE_BODY = `{
  "models": [
    {
      "model": "merchant",
      "errors": [
        {
          "occurred_at": "2026-01-05T03:12:00Z",
          "category": "test_failure",
          "message": "not_null_merchant_id returned 42 rows",
          "phase": "test",
          "details": { "dag_id": "dwh_daily", "run_id": "manual__2026-01-05" }
        }
      ]
    },
    {
      "model": "model.dwh.fact_payments_daily_aggregate",
      "errors": [
        {
          "occurred_at": "2026-01-06T02:44:10Z",
          "category": "sql_runtime_error",
          "message": "Database Error: division by zero"
        }
      ]
    }
  ]
}`;

const REQUEST_ROWS: [string, string, string][] = [
  ["models[]", "array", "one entry per model"],
  ["models[].model", "string", "dbt unique_id or model name"],
  ["models[].errors[]", "array", "the error occurrences for that model"],
  ["errors[].occurred_at", "string (ISO 8601)", "when the failure happened — required"],
  ["errors[].category", "enum", "one of the categories below — required, validated"],
  ["errors[].message", "string", "error text / root-cause summary — required"],
  ["errors[].phase", "string | null", "optional: run | test | build | compile | freshness | other"],
  ["errors[].details", "object | null", "optional freeform context (dag_id, task_id, run_id, …)"],
];

const RESPONSE_ROWS: [string, string, string][] = [
  ["models_received", "number", "how many models were in the payload"],
  ["models_matched", "number", "how many resolved to a known model"],
  ["errors_inserted", "number", "total error rows stored"],
  ["unresolved", "string[]", "model identifiers that matched no model (or were ambiguous)"],
];

const EXAMPLE_RESPONSE = `{
  "models_received": 2,
  "models_matched": 2,
  "errors_inserted": 2,
  "unresolved": []
}`;

// Assemble the whole endpoint doc as a single plain-text block. "copy context"
// copies this so it can be pasted straight into Claude as integration context.
function buildErrorsContext(base: string, errorsPath: string, curl: string): string {
  const fields = (rows: [string, string, string][]) =>
    rows.map(([f, t, d]) => `- ${f} (${t}): ${d}`).join("\n");
  const cats = Object.keys(ERROR_CATEGORY_COLORS)
    .map((c) => `- ${c}: ${CATEGORY_DESCRIPTIONS[c]}`)
    .join("\n");
  return `# Upload model errors

POST ${base}${errorsPath}

Load operational errors (Airflow build/run/test failures) for one or more dbt models.
Powers the "Color by: Errors" heat, the per-model error timeline, and the error analytics.

Semantics:
- Replace-per-model & idempotent: each model you include has its stored errors FULLY
  REPLACED by the set you send. Re-sending the full history re-syncs cleanly with no
  duplicates. Models you don't include are left untouched.
- Model identity: the "model" field accepts either the dbt unique_id (e.g.
  model.dwh.merchant) or the plain model name (e.g. merchant). Names that match no model
  — or match more than one — are skipped and returned in "unresolved".
- Persistence: errors are stored independently of the lineage graph, so re-ingesting the
  dbt manifest never wipes them. Reset a project's errors with DELETE ${errorsPath}.

Request body (application/json):
${fields(REQUEST_ROWS)}

Error categories (the "category" enum — pick exactly one per error):
${cats}

Example request body:
${EXAMPLE_BODY}

Example call:
${curl}

Response (201 Created):
${fields(RESPONSE_ROWS)}

Example response:
${EXAMPLE_RESPONSE}`;
}

export function ApiDocsView({ projectId }: { projectId: string | null }) {
  const pid = projectId ?? "{project_id}";
  const base = `${window.location.origin}/api/v1`;
  const errorsPath = `/projects/${pid}/errors`;
  const curl = `curl -X POST "${base}${errorsPath}" \\
  -H "Content-Type: application/json" \\
  -d @errors.json`;
  const errorsContext = buildErrorsContext(base, errorsPath, curl);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-semibold text-fg text-lg">API — feeding data in</h2>
        <p className="mt-1 text-muted text-sm leading-relaxed">
          These are the endpoints external systems call to <span className="text-fg">push data into</span> the
          app (for example, an Airflow error collector or a log-parsing agent). The app's read/UI endpoints
          are intentionally not listed here — this page is only for integrators feeding data in.
        </p>
        {!projectId && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
            Select a project (top-right) to see the exact URLs with its id filled in. Below,{" "}
            <code>{"{project_id}"}</code> is a placeholder.
          </p>
        )}

        <Endpoint method="POST" path={errorsPath} title="Upload model errors" context={errorsContext}>
          <p className="text-muted text-sm leading-relaxed">
            Load operational errors (Airflow build/run/test failures) for one or more models. Powers the{" "}
            <span className="text-fg">Color by: Errors</span> heat, the per-model error timeline, and the
            error analytics.
          </p>

          <Callout>
            <span className="text-fg">Replace-per-model &amp; idempotent.</span> Each model you include has
            its stored errors <em>fully replaced</em> by the set you send. Re-sending the full history
            re-syncs cleanly with no duplicates. Models you don't include are left untouched.
          </Callout>

          <Callout>
            <span className="text-fg">Model identity.</span> The <code>model</code> field accepts either the
            dbt <code>unique_id</code> (e.g. <code>model.dwh.merchant</code>) or the plain model{" "}
            <code>name</code> (e.g. <code>merchant</code>). Names that match no model — or match more than one
            — are skipped and returned in <code>unresolved</code>.
          </Callout>

          <FieldTable title="Request body" rows={REQUEST_ROWS} />

          <div className="mt-4">
            <div className="mb-1.5 font-medium text-fg text-xs">
              Error categories (the <code>category</code> enum)
            </div>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {Object.keys(ERROR_CATEGORY_COLORS).map((cat) => (
                <li key={cat} className="flex items-start gap-2 text-[12px]">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: ERROR_CATEGORY_COLORS[cat] }}
                  />
                  <span>
                    <code className="text-fg">{cat}</code>
                    <span className="text-muted"> — {CATEGORY_DESCRIPTIONS[cat]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <CodeBlock label="Example request body (errors.json)" language="json" code={EXAMPLE_BODY} />
          <CodeBlock label="Example call" language="bash" code={curl} />

          <FieldTable title="Response  ·  201 Created" rows={RESPONSE_ROWS} />
          <CodeBlock label="Example response" language="json" code={EXAMPLE_RESPONSE} />

          <Callout>
            <span className="text-fg">Persistence.</span> Errors are stored independently of the lineage
            graph, so re-ingesting the dbt manifest never wipes them. To reset a project's errors, call{" "}
            <code>DELETE {errorsPath}</code>.
          </Callout>
        </Endpoint>
      </div>
    </div>
  );
}

function Endpoint({
  method,
  path,
  title,
  context,
  children,
}: {
  method: string;
  path: string;
  title: string;
  context: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-panel p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-[11px] text-emerald-400">
          {method}
        </span>
        <code className="min-w-0 flex-1 truncate text-fg text-sm">{path}</code>
        <CopyButton text={path} />
        {/* Copies the whole endpoint doc as plain text — paste straight into Claude. */}
        <CopyButton text={context} label="copy context" />
      </div>
      <h3 className="font-medium text-fg text-sm">{title}</h3>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-panel-2 px-3 py-2 text-[12px] text-muted leading-relaxed">
      {children}
    </div>
  );
}

function FieldTable({ title, rows }: { title: string; rows: [string, string, string][] }) {
  return (
    <div className="mt-1">
      <div className="mb-1.5 font-medium text-fg text-xs">{title}</div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12px]">
          <tbody>
            {rows.map(([field, type, desc]) => (
              <tr key={field} className="border-border border-b last:border-b-0">
                <td className="whitespace-nowrap px-3 py-1.5 align-top font-mono text-fg">{field}</td>
                <td className="whitespace-nowrap px-3 py-1.5 align-top text-muted">{type}</td>
                <td className="px-3 py-1.5 align-top text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeBlock({ label, language, code }: { label: string; language: string; code: string }) {
  return (
    <div className="mt-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium text-fg text-xs">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-panel-2 p-3 text-[11px] leading-relaxed">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : label}
    </button>
  );
}

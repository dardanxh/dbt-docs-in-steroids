# dbt-docs-in-steroids

dbt's built-in docs are thin — no real analytics, and a lineage view that's hard
to read and blind to column flow. **dbt-docs-in-steroids** fixes that with:

- 🌊 **Layered lineage** — the DAG grouped into swimlanes (source → stage → dwh →
  datamart → reporting …), collapsible per layer so it's actually readable.
- 🔥 **Hotspot coloring** — color nodes by how used they are (downstream fan-out,
  centrality, …) to find the models everything depends on.
- 🧬 **Column-level lineage** — hover a model to see its columns; click one to
  trace it back to the source columns it came from, across every layer.
- 📊 **Analytics** — model/test/source/macro counts, per-layer breakdown,
  materializations, most-used models, and column-lineage coverage.
- 🧪 **Quality explorer** — a sortable worklist of models by LOC, SQL complexity,
  cohesion, and test count (heuristics); flags untested models.
- 🧭 **Daily-driver UX** — Cmd/Ctrl-K command palette, graph search + test filter,
  focus mode, column-usage fractions (e.g. `3/10`) on dependents, per-node badges,
  a syntax-highlighted SQL viewer, minimap, drag-to-reorder layers, light/dark
  themes, and a Projects manager (register from path or upload artifacts).

It reads standard dbt artifacts (`target/manifest.json` + `catalog.json`) — **no
warehouse connection needed**. Point it at a local dbt project, or upload the
artifacts.

## Stack

Python (FastAPI + SQLAlchemy + Postgres, **sqlglot** for column lineage) ·
React 19 + TypeScript (React Flow + recharts + TanStack Query).

## Quickstart

Prereqs: Docker, `uv`, `pnpm`, and a dbt project whose `target/` has a fresh
`manifest.json` (+ `catalog.json` for column types).

```bash
# 1) Backend
cd be
cp .env.example .env          # set DEFAULT_DBT_PROJECT_PATH to your dbt repo
uv sync
./dev.sh                      # starts Postgres in Docker + runs migrations
uv run uvicorn main:app --reload      # http://localhost:8000  (docs at /docs)

# 2) Frontend (new terminal)
cd ui
pnpm install
pnpm dev                      # http://localhost:5173
```

Open http://localhost:5173, click **+** to register your dbt project by path (or
**⬆** to upload `manifest.json` + `catalog.json`), and explore.

## Column-lineage coverage

Column lineage is parsed with sqlglot. It works best on **compiled** artifacts
(`dbt compile` / `dbt docs generate`, which populate `compiled_code`). For
manifests produced by `dbt parse` (no compiled SQL), a built-in lightweight
renderer resolves `ref`/`source`/`config` so plain-SQL models still get lineage;
models using custom macros/vars/control-flow are reported as uncovered. The app
shows honest per-model coverage (ok / partial / none).

## Repo layout

| Path | What |
|------|------|
| `be/` | FastAPI backend — artifact parsing, lineage graph, column lineage, REST API |
| `ui/` | React frontend — lineage canvas + analytics |
| `be/CLAUDE.md`, `ui/CLAUDE.md` | Conventions for each side |

## License

Open source — intended for public release.

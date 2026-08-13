# dbt-docs-in-steroids

A local-first, open-source webapp that fixes dbt's weak docs: a **layered lineage
graph** with hotspot coloring and **column-level lineage**, plus an **analytics**
dashboard. Reads dbt artifacts (`manifest.json` + `catalog.json`) — no warehouse
connection required.

## Monorepo layout

- `be/` — FastAPI + SQLAlchemy + Postgres backend. Parses artifacts into a
  precomputed lineage graph (nodes, edges, column edges, metrics) and serves it.
- `ui/` — Vite + React 19 + TypeScript. React Flow lineage canvas + recharts
  analytics.
- Infra/CI are intentionally deferred (this is a local tool first).

## Backend contract (see `be/CLAUDE.md`)

Strict layering **routes → services → repositories**; services take/return
Pydantic schemas, repositories own SQLAlchemy entities. Domains under
`app/domain/<name>/`: `project`, `ingestion`, `lineage`, `analytics`. Models use
SQLAlchemy 2.0 `Mapped[]`/`mapped_column`. Ruff + mypy(strict) + pytest must pass.

## Frontend contract (see `ui/CLAUDE.md`)

Feature folders under `src/features/<name>/`; TanStack Query for data; typed
`apiGet/apiPost` helpers over the proxied `/api`; Tailwind v4 (CSS-first theme in
`index.css`); Biome for lint/format. Regenerate API types with `pnpm openapi:gen`
after backend changes.

## The column-lineage engine (the core IP)

`be/app/domain/ingestion/column_lineage.py` uses **sqlglot** to trace each model's
output columns back to their direct upstream table columns — **one hop per model**,
stitched into a graph at read time. Prefers `compiled_code`; when absent (a
`dbt parse` manifest), a lightweight renderer (`jinja_render.py`) resolves
`ref`/`source`/`config` from the manifest so plain-SQL models still get lineage.
Coverage is reported honestly (ok/partial/failed per model). Full coverage needs
compiled artifacts (`dbt compile`).

## Common commands

```bash
# backend
cd be && ./dev.sh && uv run uvicorn main:app --reload   # Postgres + API :8000
uv run ruff check . && uv run mypy . && uv run pytest

# frontend
cd ui && pnpm dev                                        # :5173, proxies /api
pnpm typecheck && pnpm lint && pnpm openapi:gen
```

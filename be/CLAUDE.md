# Backend — dbt-docs-in-steroids

FastAPI + SQLAlchemy 2.0 + Postgres, managed with `uv` (Python 3.13).

## Architecture (load-bearing)

Layering: **routes → services → repositories → DB**.
- **routes** handle HTTP only; call a service; commit is owned by the service
  (except `delete`, which commits in the route).
- **services** hold business logic; take/return Pydantic schemas (never entities).
- **repositories** own SQLAlchemy entity access.

Domains live in `app/domain/<name>/{models,schemas,repositories,services,routes}.py`:
- `project` — register/list/ingest dbt projects (path or upload).
- `ingestion` — `artifacts.py` (read manifest/catalog) → `graph_builder.py` (nodes,
  edges, layers, networkx metrics) → `column_lineage.py` (sqlglot) →
  `repositories.py` (bulk persist). Orchestrated by `services.IngestionService`.
- `lineage` — the graph tables + read API (graph, node detail, column trace).
- `analytics` — counts/coverage/most-used, read from stored graph + `project.stats`.

`app/domain/__init__.py` eagerly imports every models module so Alembic sees all
tables. Models use `Mapped[...]` / `mapped_column(...)` (SQLAlchemy 2.0 typed style).

## Ingestion model

The graph is **precomputed** and stored per project, keyed by `manifest_hash`
(re-ingest is a no-op if the hash is unchanged). All read endpoints are pure
queries. Column-lineage traversal loads `column_edges` and BFS's in-memory.

## Column lineage

Parse `compiled_code` when present; else render `raw_code` via `jinja_render.py`
(resolves `ref`/`source`/`config` from manifest `relation_name`s). One hop per
model → stitch. Fallback ladder records a `ParseDiagnostic` per model; coverage is
surfaced in `/graph` and `/analytics`.

## Commands

```bash
cp .env.example .env
uv sync
./dev.sh                                   # Postgres in Docker + alembic upgrade
uv run uvicorn main:app --reload           # :8000, docs at /docs
uv run alembic revision --autogenerate -m "msg" && uv run alembic upgrade head
uv run ruff check . && uv run ruff format . && uv run mypy . && uv run pytest
```

## Gotchas

- Manifests from `dbt parse` have no `compiled_code` — the renderer handles the
  common cases; macros/vars/`{% %}` remain uncovered (reported honestly). Provide
  compiled artifacts for ~100% coverage.
- `data_type` is `Text` (BigQuery STRUCT/ARRAY types overflow varchar).
- Ingestion commits at RUNNING so a failed parse is recorded on a live project row.

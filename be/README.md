# dbt-docs-in-steroids — Backend

FastAPI + SQLAlchemy + Postgres. Parses dbt artifacts (`manifest.json`,
`catalog.json`) into a layered lineage graph, hotspot metrics, and column-level
lineage (via sqlglot), then serves them over a REST API.

## Quickstart

```bash
cp .env.example .env          # adjust DEFAULT_DBT_PROJECT_PATH if needed
uv sync
./dev.sh                      # start Postgres in Docker + run migrations
uv run uvicorn main:app --reload   # API on http://localhost:8000  (docs at /docs)
```

Register + ingest the local dbt project (uses DEFAULT_DBT_PROJECT_PATH):

```bash
curl -s localhost:8000/api/v1/projects/ -H 'content-type: application/json' \
  -d '{"name":"my-project","path":"/path/to/your/dbt-project"}' | jq
```

## Layout

```
app/
├── core/           # db base, enums, exceptions
├── dependencies/   # db session
└── domain/
    ├── project/    # register/list/ingest dbt projects
    ├── ingestion/  # artifacts → graph → column-lineage → Postgres
    ├── lineage/    # graph tables + read API (graph, node detail, column trace)
    └── analytics/  # counts, coverage, most-used models
```

## Commands

```bash
uv run alembic revision --autogenerate -m "msg"
uv run alembic upgrade head
uv run ruff check . && uv run ruff format .
uv run mypy .
uv run pytest
```

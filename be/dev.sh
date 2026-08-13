#!/usr/bin/env bash
set -euo pipefail

# Spin up local Postgres in Docker and run migrations. Mirrors worch/be/dev.sh
# but without MinIO (this app reads dbt artifacts from disk, no object store).

CONTAINER_NAME="dbtsteroids-postgres"
DB_NAME="dbtsteroids"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_PORT="5432"
PG_VOLUME="dbtsteroids-postgres-data"

docker volume create "$PG_VOLUME" > /dev/null 2>&1 || true

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "PostgreSQL container already running."
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Starting existing PostgreSQL container..."
    docker start "$CONTAINER_NAME" > /dev/null
else
    echo "Creating new PostgreSQL container..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e POSTGRES_DB="$DB_NAME" \
        -e POSTGRES_USER="$DB_USER" \
        -e POSTGRES_PASSWORD="$DB_PASSWORD" \
        -p "$DB_PORT":5432 \
        -v "$PG_VOLUME":/var/lib/postgresql/data \
        postgres:17-alpine
fi

echo "Waiting for PostgreSQL to be ready..."
until docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; do
    sleep 1
done

echo ""
echo "=== PostgreSQL Local Dev ==="
echo "URL: postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"
echo "============================"

echo ""
echo "Running migrations..."
uv run alembic upgrade head
echo "Migrations complete."

#!/usr/bin/env bash
# Developer helper: writes a new migration from schema.prisma without touching your real database.
#   bash scripts/diff-migration.sh <name>
# Needs a PostgreSQL server reachable with BASE_URL (default: postgresql://postgres@localhost:5432).
set -euo pipefail
NAME=${1:?migration name}
BASE=${BASE_URL:-postgresql://postgres@localhost:5432}
TMP=laalpen_diff_$(date +%s)
psql "$BASE/postgres" -qc "CREATE DATABASE $TMP" >/dev/null
trap 'psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $TMP WITH (FORCE)" >/dev/null' EXIT
DATABASE_URL="$BASE/$TMP?schema=public" npx prisma migrate deploy >/dev/null
DIR=prisma/migrations/$(date -u +%Y%m%d%H%M%S)_$NAME
mkdir -p "$DIR"
DATABASE_URL="$BASE/$TMP?schema=public" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$DIR/migration.sql"
echo "wrote $DIR/migration.sql"

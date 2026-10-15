#!/bin/sh
# Render start: run migrations + idempotent demo seed on the direct (non-pooled) Neon URL, then start the API.
# The seed also restores the demo copy images, because Render's free disk is wiped on every restart.
set -e
MIGRATE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy
if [ "${SEED_DEMO:-true}" != "false" ]; then DATABASE_URL="$MIGRATE_URL" npx prisma db seed; fi
exec node dist/main.js

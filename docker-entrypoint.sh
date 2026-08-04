#!/bin/sh
# Bring an empty volume up to a playable state, then hand off to the server.
#
# Idempotent: `prisma db push` is a no-op against a schema that already
# matches, and the seed upserts by id. A container restart re-runs both and
# changes nothing — including player progress, which lives in rows the seed
# never touches.
set -e

: "${DATABASE_URL:=file:/data/sg.db}"
export DATABASE_URL

echo "[sg] database: $DATABASE_URL"

# `migrate deploy` only rolls migrations forward and never prompts. Not
# `db push`: Prisma 7 makes it demand interactive consent for a possibly
# destructive change, which in an entrypoint means the container aborts on
# first boot. db push stays a dev tool.
npx --no-install prisma migrate deploy

# Seeds holes and puzzles from data/holes/*.json. Warm heatmap grids are
# computed here so the first player doesn't pay for them.
if [ "${SG_SKIP_SEED:-0}" != "1" ]; then
  npm run db:seed
fi

echo "[sg] ready on :${PORT:-3000}"
exec "$@"

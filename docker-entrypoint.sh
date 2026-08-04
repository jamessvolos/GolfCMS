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

# A bind-mounted host directory keeps the HOST's ownership, which the image's
# chown cannot change — so /data is frequently not writable by the `node`
# user this container runs as. Prisma reports that as a bare "unable to open
# database file" from inside a schema-engine stack trace. Say it plainly.
case "$DATABASE_URL" in
  file:*)
    db_path=${DATABASE_URL#file:}
    db_dir=$(dirname "$db_path")
    if [ ! -d "$db_dir" ]; then
      echo "[sg] error: $db_dir does not exist — mount a volume there" >&2
      exit 1
    fi
    if [ ! -w "$db_dir" ]; then
      echo "[sg] error: $db_dir is not writable by uid $(id -u)." >&2
      echo "[sg]   A named volume (-v sg-data:/data) inherits the image's" >&2
      echo "[sg]   ownership and just works. A bind mount keeps the host's:" >&2
      echo "[sg]   either chown it to $(id -u) on the host, or run with" >&2
      echo "[sg]   --user \$(id -u):\$(id -g)." >&2
      exit 1
    fi
    ;;
esac

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

# Deploying SG Trainer

The app is a single Next.js server plus one SQLite file. There is no auth, no
background worker, and no external service beyond the imagery tiles the
browser fetches directly from Esri.

## What CI checks

`.github/workflows/ci.yml` runs on every push:

| Gate | Why it exists |
| --- | --- |
| `npm run typecheck` | — |
| `npm run db:drift` | Migrations must match `schema.prisma`. A container boots with `migrate deploy`; a schema change that never became a migration ships a server whose queries reference columns the database does not have. |
| `npm test` | Engine, cache, progression, explanation. |
| `npm run content:audit` | Content is code. A self-intersecting ring or a pin off the green fails the build, not a player's session. |
| `npm run build` | Also proves `prebuild` put the MapLibre worker in `public/vendor` — `next start` only serves public files that existed at build time. |
| Docker build + boot | The image is built and run against an empty volume, which exercises the entrypoint end to end: migrate, seed, serve the hole listing. |

The Docker job is the only place the image is verified. It cannot be built in
the Anthropic dev container — Docker Hub's blob CDN is not reachable through
the agent proxy — so treat a red `docker` job as the real signal.

## Running the image

```bash
docker build -t sg-trainer .
docker run -p 3000:3000 -v sg-data:/data sg-trainer
```

Use a **named volume**, as above. The container runs as the unprivileged
`node` user, and a bind-mounted host directory keeps the host's ownership —
which the image's `chown` cannot change — so `/data` ends up unwritable and
the database cannot be created. The entrypoint checks for this and says so
rather than letting Prisma fail with a bare "unable to open database file".
If you do need a bind mount, `chown` the host directory to uid 1000 or run
with `--user $(id -u):$(id -g)`.

First boot applies migrations and seeds 10 holes / 26 puzzles from
`data/holes/*.json`, warming a heatmap grid per puzzle at the seed profile
(~14s). Restarts re-run both: `migrate deploy` finds nothing pending and the
seed upserts by id, so player progress — which lives in rows the seed never
touches — survives.

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:/data/sg.db` in the image | Put it on the volume, not in the image layer. |
| `PORT` | `3000` | |
| `SG_SKIP_SEED` | `0` | Set to `1` to boot without seeding — for a host whose content is already ingested through `/api/admin/hole`. |
| `NEXT_PUBLIC_TILE_PROXY` | unset | Leave unset in production. It exists for sandboxed dev containers whose browser cannot reach Esri; setting it routes every tile through `/api/tiles`, which makes your server pay for imagery bandwidth. |

### Imagery

In production the browser talks to `server.arcgisonline.com` directly and
MapLibre's attribution control displays Esri's credit. Nothing needs an API
key. Esri's terms permit this use; Google's do not, which is why the map is
MapLibre and the tiles are Esri.

## Upgrading a database made with `db push`

Databases created before migrations existed have the right tables and no
migration history, so `migrate deploy` refuses with `P3005`. Baseline once:

```bash
npx prisma migrate resolve --applied 0_init
```

After that `npm run db:migrate` is a no-op and future migrations apply
normally. A fresh database needs none of this.

## Moving to Postgres

The schema is written to port: SQLite has no native enums, so `shotShape`,
`lie`, `category` and `band` are `String` columns validated with zod at the
boundary, and they become real enums when the datasource changes.

1. `datasource db { provider = "postgresql" }` in `prisma/schema.prisma`.
2. Swap `PrismaBetterSqlite3` for the Postgres adapter in `lib/server/db.ts`.
3. Regenerate `prisma/migrations/` against the new provider — the committed
   SQL is SQLite dialect and does not carry over. Delete `0_init`, run
   `prisma migrate dev --name init` against an empty Postgres database, and
   commit the result.
4. Run migrations outside the image. Once first boot no longer creates the
   schema, `output: 'standalone'` in `next.config.ts` becomes the right call
   and the runtime image loses its `node_modules` — see the note at the top
   of the `Dockerfile` for why it carries them today.

The one thing that does not port for free is `HeatmapCache.grid`, a JSON
string in a `TEXT` column. It works as-is on Postgres; `jsonb` would be
better if anything ever needs to query inside it. Nothing does today.

## Hosting notes

Any host that runs a container with a persistent volume works — Fly, Railway,
Render, a VPS. Vercel does not: the filesystem is ephemeral, so SQLite loses
every attempt on each deploy. Move to Postgres first if that is the target.

Scaling is single-instance by construction. Two replicas against one SQLite
file will corrupt it. That limit is fine for the size this product is, and
Postgres removes it.

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
| Warm restart under 20s | The container is restarted and must serve again quickly. Re-ingesting unchanged content costs ~20s and shows up only as slow deploys — a silent failure worth a gate. |

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

First boot applies migrations and seeds 20 holes / 36 puzzles from
`data/holes/*.json`, warming a heatmap grid per puzzle at the seed profile
(~20s). Restarts re-run both, but cheaply: `migrate deploy` finds nothing
pending and the seed leaves alone any hole already present with identical
geometry and warm grids, so a warm restart is ~2s. Player progress lives in
rows the seed never touches and survives either way.

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

## Hosting

**Fly is the best fit, and the reason is SQLite.** Its unit of deployment is
one machine with one attached volume, which is exactly this app's shape; it
can suspend to zero and wake on a request, which suits a personal trainer
that is idle most of the day; and it is the cheapest always-on option of the
candidates. `fly.toml` in the repo root is ready to use:

```bash
fly launch --no-deploy --copy-config --name <your-app>
fly volumes create sg_data --size 1 --region lhr --yes
fly deploy --image ghcr.io/jamessvolos/golfcms:latest
```

The one rule: **keep it at a single machine.** Two machines cannot share a
Fly volume, and two machines with separate volumes would each hold a
divergent copy of every player's progress. `fly scale count 1` if it drifts.

The alternatives, and why they lose:

| Host | Verdict |
| --- | --- |
| **Railway** | Works well — image deploy plus a volume at `/data`. Slightly simpler UI, no scale-to-zero, so you pay for idle. |
| **Render** | Works, but persistent disks require a paid instance type; the free tier has no disk at all, which silently means no saved progress. |
| **A VPS** | Most control and predictable cost, but you own the OS, TLS and updates for what is one `docker run`. |
| **Vercel** | Does not work. The filesystem is ephemeral, so SQLite loses every attempt on each deploy. Move to Postgres first if this is the target. |

### Restarts are cheap, first boot is not

Seeding recomputes a Monte Carlo grid per puzzle, which is ~20 seconds for
the shipped library. The seed skips any hole already present with identical
geometry and warm grids at the seed bucket, so a restart on a populated
volume costs about 2 seconds and a redeploy is not 20 seconds of downtime.
CI asserts this — a warm restart that takes over 20 seconds fails the build,
because the failure mode is silent and only shows up as slow deploys.

`SG_SEED_FORCE=1` re-ingests everything regardless, which is what you want
after changing an engine constant that does not bump `GRID_VERSION`.

### Before it is public

There is no auth. `/admin/annotate` and `/admin/import` are reachable by
anyone who finds them, and the import endpoint will happily spend your CPU
on Overpass queries. That is fine behind a private URL and not fine on a
public one — put a shared-secret gate on `/admin` and `/api/admin` first.

The GHCR package is private by default. Either make it public in the
repository's Packages settings, or `docker login ghcr.io` on the host with a
token that has `read:packages`.

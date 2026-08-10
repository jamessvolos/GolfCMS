# Deploying the leaderboard

`server/leaderboard.js` is a single-file, dependency-free Node service. It
verifies every submitted score by re-simulating the replay against the seed,
so it can safely run anywhere. Three ways to put it online:

## Path 1 — Render (free tier)

1. Fork/push this repo to your GitHub account.
2. On [render.com](https://render.com): **New → Blueprint**, connect the repo.
   Render reads `render.yaml` at the root and creates a free Docker web
   service named `golfcms-leaderboard`.
3. When the deploy finishes you get a URL like
   `https://golfcms-leaderboard.onrender.com`.

Caveats: the free instance sleeps after ~15 minutes idle (first request wakes
it in ~30s), and its disk is ephemeral — boards reset on redeploys. For
durable boards, attach a persistent disk (paid) and set
`GOLFCMS_BOARD_FILE=/var/data/boards.json` in the service's environment.

## Path 2 — Fly.io

1. Install `flyctl` and sign in.
2. From the repo root:
   ```sh
   fly launch --copy-config --no-deploy   # uses fly.toml + Dockerfile
   fly deploy
   ```
3. Your URL is `https://<app-name>.fly.dev`.
4. Optional persistence:
   ```sh
   fly volumes create boards -s 1
   ```
   then uncomment the `[mounts]` block and the `GOLFCMS_BOARD_FILE` line in
   `fly.toml` and `fly deploy` again.

## Path 3 — bare VPS

Any box with Node 22+ (no npm install needed):

```sh
git clone https://github.com/jamessvolos/GolfCMS.git
cd GolfCMS
GOLFCMS_BOARD_FILE=/var/lib/golfcms/boards.json node server/leaderboard.js 8787
```

Keep it alive with systemd:

```ini
# /etc/systemd/system/golfcms-leaderboard.service
[Unit]
Description=GolfCMS leaderboard
After=network.target

[Service]
WorkingDirectory=/opt/GolfCMS
Environment=GOLFCMS_BOARD_FILE=/var/lib/golfcms/boards.json
ExecStart=/usr/bin/node server/leaderboard.js 8787
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Put nginx/Caddy in front for TLS if the game is served over HTTPS (browsers
block mixed content). The service already sends permissive CORS headers.

## Pointing the game at your server

Once deployed, tell the game where the board lives. On the game page, open
devtools and run:

```js
localStorage.setItem('golfcms.leaderboard.url', 'https://your-server.example');
```

or in the Caddie cockpit: **My game → Leaderboard URL → Apply my pattern**.
The field reads and writes the same `golfcms.leaderboard.url` key.

- **Arcade** (`arcade.html`): fully wired — when you hole out, it silently
  POSTs your ghost replay to `<url>/scores` and shows your rank. Failures are
  silent; the game never depends on the server.
- **Caddie** (the main game, `index.html`): stores the URL today, but does
  not submit yet. Caddie rounds have no replay codec, and the leaderboard's
  cheat-proofing is replay re-simulation — a Caddie submission format
  (decision transcript + re-scoring) is scoreboard-v2 work.

# SG Trainer — single-container deployment (Next server + SQLite on a volume).
#
# Deliberately NOT using Next's `output: 'standalone'`. Standalone gives a
# smaller image, but first boot has to create and seed the database, which
# needs the Prisma CLI, tsx, and the seed script's path aliases — none of
# which standalone traces. Carrying full node_modules costs disk and buys a
# container that bootstraps itself from an empty volume. When this moves to
# Postgres, migrations run outside the image and standalone becomes the
# right call; see docs/deploy.md.

# ---------------------------------------------------------------- builder
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Build tools for better-sqlite3's native addon; prebuilds cover most
# platforms but arm64 and musl fall back to node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate` → lib/generated/prisma.
RUN npm ci

COPY . .
# prebuild copies the MapLibre worker into public/vendor. `next start` only
# serves public files that existed at build time, so this must precede build.
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/sg.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/data ./data
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json /app/package-lock.json \
     /app/prisma.config.ts /app/tsconfig.json /app/next.config.ts ./
COPY docker-entrypoint.sh /usr/local/bin/

# The database lives on a volume, not in the image layer.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]

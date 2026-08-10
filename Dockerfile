# GolfCMS leaderboard — a single-file Node service, no npm install needed.
# Build:  docker build -t golfcms-leaderboard .
# Run:    docker run -p 8787:8787 golfcms-leaderboard
# Persist boards across restarts by mounting a volume and setting
# GOLFCMS_BOARD_FILE, e.g.:
#   docker run -p 8787:8787 -v boards:/data \
#     -e GOLFCMS_BOARD_FILE=/data/boards.json golfcms-leaderboard
FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 8787
CMD ["node", "server/leaderboard.js"]

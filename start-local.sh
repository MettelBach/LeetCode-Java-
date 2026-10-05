#!/usr/bin/env sh
# SellHub: local start on macOS / Linux (needs Node.js 22+)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 22 LTS from https://nodejs.org"; exit 1; }
[ -d server/node_modules ] || npm run install:all
[ -f server/dist/index.js ] || npm run build
echo "SellHub: http://localhost:3001  (support panel: http://localhost:3001/admin)"
( sleep 2; (open http://localhost:3001 || xdg-open http://localhost:3001) >/dev/null 2>&1 ) &
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@localhost.pl} ADMIN_PASSWORD=${ADMIN_PASSWORD:-Lokalny-Panel-2026} exec node server/dist/index.js

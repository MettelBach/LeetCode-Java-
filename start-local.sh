#!/usr/bin/env sh
# SellHub: local start on macOS / Linux (needs Node.js 22 or newer)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 22 LTS or newer from https://nodejs.org"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node.js 22 or newer is required"; exit 1; }
if [ ! -f server/node_modules/better-sqlite3/build/Release/better_sqlite3.node ] || [ ! -f web/node_modules/vite/package.json ]; then
  rm -rf server/node_modules web/node_modules
  npm run install:all
fi
[ -f server/dist/index.js ] && [ -f web/dist/index.html ] || npm run build
echo "SellHub: http://localhost:3001  (support panel: http://localhost:3001/admin)"
( sleep 2; (open http://localhost:3001 || xdg-open http://localhost:3001) >/dev/null 2>&1 ) &
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@localhost.pl} ADMIN_PASSWORD=${ADMIN_PASSWORD:-Lokalny-Panel-2026} exec node server/dist/index.js

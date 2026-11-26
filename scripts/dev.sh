#!/usr/bin/env bash
# A throwaway local Gizlet with sample content, for trying the site in a browser:
#
#   pnpm dev            # http://localhost:8787; the other hosts are under /_host/<host>/
#
# GitHub is the test fixture server (tests/fixtures/server.mjs) and Postgres is in-memory
# PGlite, so nothing touches the network and every start is fresh. A few fixture gizlets are
# published on start, among them tests/fixtures/repos/rocket-snail; the admin token is `dev-admin`.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8787}
FIXTURE_PORT=18798
PG_PORT=18789 # hyperdrive.localConnectionString in wrangler.jsonc
FIXTURE="http://127.0.0.1:$FIXTURE_PORT"
API="http://127.0.0.1:$PORT"
STATE=$(mktemp -d "${TMPDIR:-/tmp}/gizlet-dev.XXXXXX")
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  for p in "$PORT" "$FIXTURE_PORT" "$PG_PORT"; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done
  rm -rf "$STATE"
}
trap cleanup EXIT INT TERM
for p in "$PORT" "$FIXTURE_PORT" "$PG_PORT"; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done

node tests/fixtures/server.mjs "$FIXTURE_PORT" >"$STATE/fixture.log" 2>&1 &
pids+=($!)
node scripts/pg.ts serve "$PG_PORT" >"$STATE/pg.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do grep -q postgresql "$STATE/pg.log" 2>/dev/null && break; sleep 0.25; done
DATABASE_URL=$(grep -m1 postgresql "$STATE/pg.log") node scripts/pg.ts migrate
pnpm exec wrangler d1 migrations apply gizlet --local --persist-to "$STATE/wrangler" >/dev/null
for _ in $(seq 1 60); do curl -fsS "$FIXTURE/healthz" >/dev/null 2>&1 && break; sleep 0.25; done
APP_KEY=$(curl -fsS "$FIXTURE/_fixture/app-key" | awk '{printf "%s\\n", $0}')

# Publish sample gizlets once the Worker answers.
(
  for _ in $(seq 1 120); do curl -fsS -H 'x-gizlet-host: api.gizlet.io' "$API/v1/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
  publish() {
    local token
    token=$(curl -fsS "$FIXTURE/token?repo=$1&ref=refs/tags/$2" | node -e 'process.stdin.on("data", (d) => console.log(JSON.parse(d).value))')
    curl -fsS -o /dev/null -X POST -H 'x-gizlet-host: api.gizlet.io' -H "authorization: Bearer $token" "$API/v1/publish" -d '{}'
  }
  publish fixture-org/rocket-snail v0.1.0
  publish fixture-org/hello-gizlet v0.1.0
  publish fixture-org/hello-gizlet v0.2.0
  for repo in on-demand symlink; do curl -fsS -o /dev/null -H 'x-gizlet-host: api.gizlet.io' "$API/v1/gizlets/github.com/fixture-org/$repo" || true; done
  echo "==> Sample gizlets published: http://localhost:$PORT/github.com/fixture-org/rocket-snail"
) &
pids+=($!)

# --local-upstream keeps the browser's Host and Origin; by default wrangler rewrites them to gizlet.io.
pnpm exec wrangler dev --port "$PORT" --ip 127.0.0.1 --local-upstream "localhost:$PORT" --persist-to "$STATE/wrangler" --show-interactive-dev-session=false \
  --var DEV_HOST_OVERRIDE:1 \
  --var "SITE_ORIGIN:http://localhost:$PORT" \
  --var "API_ORIGIN:http://localhost:$PORT/_host/api.gizlet.io" \
  --var "DL_ORIGIN:http://localhost:$PORT/_host/dl.gizlet.io" \
  --var "GITHUB_WEB:$FIXTURE" \
  --var "GITHUB_RAW:$FIXTURE" \
  --var "GITHUB_API:$FIXTURE" \
  --var "GITHUB_APP_CLIENT_ID:Iv-fixture" \
  --var "GITHUB_APP_PRIVATE_KEY:$APP_KEY" \
  --var "OIDC_ISSUER:$FIXTURE" \
  --var "OIDC_JWKS_URL:$FIXTURE/.well-known/jwks" \
  --var "ADMIN_TOKEN:dev-admin" \
  --var "BETTER_AUTH_SECRET:dev-secret-$(openssl rand -hex 16)"

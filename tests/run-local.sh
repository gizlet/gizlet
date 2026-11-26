#!/usr/bin/env bash
# Run the Hurl suite in tests/hurl and the device simulation in tests/sim against
# `wrangler dev`, with a fake GitHub (tests/fixtures/server.mjs) and an in-memory
# Postgres (PGlite) for accounts.
#
#   pnpm test:hurl            # all files
#   pnpm test:hurl 05-auth    # Hurl files matching a pattern
#   pnpm test:hurl sim        # the device simulation only
set -euo pipefail
cd "$(dirname "$0")/.."

FIXTURE_PORT=${FIXTURE_PORT:-18788}
DEV_PORT=${DEV_PORT:-18787}
# Must match hyperdrive.localConnectionString in wrangler.jsonc.
PG_PORT=18789
STATE=$(mktemp -d "${TMPDIR:-/tmp}/gizlet-test.XXXXXX")
FIXTURE="http://127.0.0.1:$FIXTURE_PORT"
# The site origin the Worker believes it serves. Not the dev server itself: wrangler dev drops
# Access-Control-Allow-Origin headers that name its own origin. Cookies for it never reach
# 127.0.0.1, so the tests authenticate with bearer tokens only.
SITE="http://gizlet.test"
ADMIN_TOKEN="test-admin-$(date +%s)"
pids=()
free_ports() {
  # wrangler leaves workerd children behind; stop whatever still listens on our ports.
  for p in "$DEV_PORT" "$FIXTURE_PORT" "$PG_PORT"; do
    lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
}
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  free_ports
  rm -rf "$STATE"
}
trap cleanup EXIT
free_ports

node tests/fixtures/server.mjs "$FIXTURE_PORT" >"$STATE/fixture.log" 2>&1 &
pids+=($!)
node scripts/pg.ts serve "$PG_PORT" >"$STATE/pg.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do grep -q postgresql "$STATE/pg.log" 2>/dev/null && break; sleep 0.25; done
DATABASE_URL=$(grep -m1 postgresql "$STATE/pg.log") node scripts/pg.ts migrate >"$STATE/pg-migrate.log" 2>&1 \
  || { cat "$STATE/pg.log" "$STATE/pg-migrate.log"; exit 1; }

pnpm exec wrangler d1 migrations apply gizlet --local --persist-to "$STATE/wrangler" >"$STATE/migrate.log" 2>&1 \
  || { cat "$STATE/migrate.log"; exit 1; }

pnpm exec wrangler dev --port "$DEV_PORT" --ip 127.0.0.1 --persist-to "$STATE/wrangler" --show-interactive-dev-session=false \
  --var DEV_HOST_OVERRIDE:1 \
  --var "SITE_ORIGIN:$SITE" \
  --var "SITE_DOMAINS:mirror.test" \
  --var "GITHUB_WEB:$FIXTURE" \
  --var "GITHUB_RAW:$FIXTURE" \
  --var "GITHUB_API:$FIXTURE" \
  --var "OIDC_ISSUER:$FIXTURE" \
  --var "OIDC_JWKS_URL:$FIXTURE/.well-known/jwks" \
  --var "ADMIN_TOKEN:$ADMIN_TOKEN" \
  --var "BETTER_AUTH_SECRET:test-secret-$(openssl rand -hex 16)" \
  >"$STATE/dev.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 120); do
  curl -fsS -H 'x-gizlet-host: api.gizlet.io' "http://127.0.0.1:$DEV_PORT/v1/healthz" >/dev/null 2>&1 \
    && curl -fsS "$FIXTURE/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -H 'x-gizlet-host: api.gizlet.io' "http://127.0.0.1:$DEV_PORT/v1/healthz" >/dev/null || { cat "$STATE/dev.log"; exit 1; }

pattern=${1:-}
status=0
shopt -s nullglob
files=(tests/hurl/*${pattern}*.hurl)
if [[ ${#files[@]} -gt 0 ]]; then
  hurl --test --jobs 1 \
    --variable "base=http://127.0.0.1:$DEV_PORT" \
    --variable "site=$SITE" \
    --variable "fixture=$FIXTURE" \
    --variable "admin_token=$ADMIN_TOKEN" \
    --variable "run=$(date +%s)" \
    "${files[@]}" || status=$?
fi
# The device simulation runs with the full suite, or alone with `pnpm test:hurl sim`.
if [[ $status -eq 0 && ( -z $pattern || $pattern == sim ) ]]; then
  echo "--- device simulation (tests/sim/device.mjs) ---"
  BASE="http://127.0.0.1:$DEV_PORT" FIXTURE="$FIXTURE" SITE="$SITE" node tests/sim/device.mjs || status=$?
fi
if [[ $status -ne 0 ]]; then
  echo "--- wrangler dev log (tail) ---"
  tail -80 "$STATE/dev.log"
fi
exit $status

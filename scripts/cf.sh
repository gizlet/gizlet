#!/usr/bin/env bash
# Run wrangler with the deploy credentials from secrets/deploy.enc.yaml.
#
#   pnpm cf deploy
#   pnpm cf tail
#   pnpm cf d1 migrations apply gizlet-store --remote
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  exec pnpm exec wrangler "$@"
fi
quoted=$(printf ' %q' "$@")
exec scripts/sops.sh exec-env secrets/deploy.enc.yaml "pnpm exec wrangler${quoted}"

#!/usr/bin/env bash
# Run sops with the Gizlet age identity.
# Locally the identity is read from the macOS login Keychain;
# in CI it comes from the SOPS_AGE_KEY secret.
#
#   scripts/sops.sh edit secrets/deploy.enc.yaml
#   scripts/sops.sh exec-env secrets/deploy.enc.yaml 'npx wrangler deploy'
set -euo pipefail

KEYCHAIN_SERVICE="io.gizlet.store.sops.age"

if [[ -z "${SOPS_AGE_KEY:-}" ]]; then
  if ! command -v security >/dev/null 2>&1; then
    echo "SOPS_AGE_KEY is not set and macOS Keychain is unavailable" >&2
    exit 1
  fi
  SOPS_AGE_KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$USER" -w)"
  export SOPS_AGE_KEY
fi

cd "$(dirname "$0")/.."
exec sops "$@"

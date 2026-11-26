#!/usr/bin/env bash
# Runs the rendered mirror in Docker (nginx:stable-alpine) with a self-signed certificate,
# in front of the real gizlet.io, and checks it with tests/mirror/*.hurl. Read-only on
# gizlet.io except one failed sign-in. Needs Docker, Hurl and openssl.
#
#   mirror/smoke.sh                # as gizlet.xyz
#   mirror/smoke.sh gizlet.example
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mirror="${1:-gizlet.xyz}"
origin="${ORIGIN_DOMAIN:-gizlet.io}"
https_port="${SMOKE_HTTPS_PORT:-18443}"
http_port="${SMOKE_HTTP_PORT:-18080}"
name="gizlet-mirror-smoke-$$"

work="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$mirror" \
  -addext "subjectAltName=DNS:$mirror,DNS:www.$mirror,DNS:api.$mirror,DNS:dl.$mirror" \
  -keyout "$work/privkey.pem" -out "$work/fullchain.pem" 2>/dev/null
mkdir -p "$work/acme"
SSL_CERT=/certs/fullchain.pem SSL_KEY=/certs/privkey.pem ACME_ROOT=/var/www/acme \
  "$here/render.sh" "$mirror" > "$work/mirror.conf"

docker run -d --name "$name" \
  -p "127.0.0.1:$https_port:443" -p "127.0.0.1:$http_port:80" \
  -v "$work/mirror.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$work/fullchain.pem:/certs/fullchain.pem:ro" \
  -v "$work/privkey.pem:/certs/privkey.pem:ro" \
  -v "$work/acme:/var/www/acme:ro" \
  nginx:stable-alpine >/dev/null

for _ in $(seq 1 40); do
  curl -fsS -o /dev/null -k --connect-to "$mirror:443:127.0.0.1:$https_port" "https://$mirror/static/site.css" 2>/dev/null && break
  if [[ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]]; then docker logs "$name"; exit 1; fi
  sleep 0.5
done

connect=()
for h in "$mirror" "www.$mirror" "api.$mirror" "dl.$mirror"; do
  connect+=(--connect-to "$h:443:127.0.0.1:$https_port" --connect-to "$h:80:127.0.0.1:$http_port")
done

status=0
hurl --test --insecure "${connect[@]}" \
  --variable "mirror=$mirror" --variable "origin=$origin" \
  "$here"/../tests/mirror/*.hurl || status=$?
if [[ $status -ne 0 ]]; then docker logs "$name" 2>&1 | tail -n 40; fi
exit $status

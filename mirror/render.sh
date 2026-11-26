#!/usr/bin/env bash
# Renders mirror/nginx.conf.template for one mirror domain and prints it.
#
#   mirror/render.sh gizlet.xyz > /etc/nginx/conf.d/gizlet-mirror.conf
#
# Settings come from the environment:
#   ORIGIN_DOMAIN  the domain mirrored (gizlet.io)
#   SSL_CERT       certificate for the mirror and its www, api and dl hosts
#                  (/etc/letsencrypt/live/<mirror>/fullchain.pem)
#   SSL_KEY        its key (/etc/letsencrypt/live/<mirror>/privkey.pem)
#   CA_BUNDLE      CAs trusted for the upstream's certificate (/etc/ssl/certs/ca-certificates.crt)
#   RESOLVER       DNS servers for the upstream hosts ("1.1.1.1 8.8.8.8")
#   ACME_ROOT      webroot for ACME HTTP challenges (/var/www/acme)
#   HTTPS_PORT     443
#   HTTP_PORT      80
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mirror="${1:-}"
origin="${ORIGIN_DOMAIN:-gizlet.io}"

domain='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
if [[ ! "$mirror" =~ $domain ]]; then
  echo "usage: $0 <mirror-domain>   (for example gizlet.xyz)" >&2
  exit 2
fi
if [[ ! "$origin" =~ $domain ]]; then
  echo "ORIGIN_DOMAIN is not a domain: $origin" >&2
  exit 2
fi
if [[ "$mirror" == "$origin" || "$mirror" == *".$origin" ]]; then
  echo "the mirror domain must not be $origin or one of its subdomains" >&2
  exit 2
fi

ssl_cert="${SSL_CERT:-/etc/letsencrypt/live/$mirror/fullchain.pem}"
ssl_key="${SSL_KEY:-/etc/letsencrypt/live/$mirror/privkey.pem}"
ca_bundle="${CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"
resolver="${RESOLVER:-1.1.1.1 8.8.8.8}"
acme_root="${ACME_ROOT:-/var/www/acme}"
https_port="${HTTPS_PORT:-443}"
http_port="${HTTP_PORT:-80}"

for v in "$ssl_cert" "$ssl_key" "$ca_bundle" "$acme_root"; do
  [[ "$v" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "not an absolute path of plain characters: $v" >&2; exit 2; }
done
addresses='^[][A-Za-z0-9.: -]+$'
[[ "$resolver" =~ $addresses ]] || { echo "RESOLVER is not a list of addresses: $resolver" >&2; exit 2; }
[[ "$https_port" =~ ^[0-9]+$ && "$http_port" =~ ^[0-9]+$ ]] || { echo "ports must be numbers" >&2; exit 2; }

# Every value is checked above to hold no sed metacharacters but "." and "/" ("|" is the delimiter).
re() { printf '%s' "$1" | sed 's/\./\\\\./g'; }
sed \
  -e "s|@MIRROR_RE@|$(re "$mirror")|g" \
  -e "s|@ORIGIN_RE@|$(re "$origin")|g" \
  -e "s|@MIRROR@|$mirror|g" \
  -e "s|@ORIGIN@|$origin|g" \
  -e "s|@SSL_CERT@|$ssl_cert|g" \
  -e "s|@SSL_KEY@|$ssl_key|g" \
  -e "s|@CA_BUNDLE@|$ca_bundle|g" \
  -e "s|@RESOLVER@|$resolver|g" \
  -e "s|@ACME_ROOT@|$acme_root|g" \
  -e "s|@HTTPS_PORT@|$https_port|g" \
  -e "s|@HTTP_PORT@|$http_port|g" \
  "$here/nginx.conf.template"

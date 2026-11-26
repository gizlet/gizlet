# Mirror domains

An nginx reverse proxy that serves all of Gizlet under another domain, such as `gizlet.xyz`. It does not need a second deployment: the Worker, D1, R2 and the account database stay the same. It is not deployed yet.

| Mirror host | Proxies to | Notes |
| --- | --- | --- |
| `gizlet.xyz` | `gizlet.io` | Site, share pages, sign-in, `/device`, `/account`, `/v1/auth/*` |
| `api.gizlet.xyz` | `api.gizlet.io` | The JSON API |
| `dl.gizlet.xyz` | `dl.gizlet.io` | Streamed as is: `Range`, `X-Checksum-Sha256`, no buffering to disk |
| `www.gizlet.xyz` | | Redirects to `gizlet.xyz` |

The proxy rewrites what names `gizlet.io` so that clients stay on the mirror:

- Absolute URLs (`https://gizlet.io`, `https://api.gizlet.io`, `https://dl.gizlet.io`) in HTML, JSON, scripts and stylesheets: `share_url`, `api_url`, package URLs, `status_url`, `verification_uri` and page links. Bare hostnames in text (`gizlet.io/github.com/...`) are left as is.
- `Location` headers, the `Domain` of cookies, `Access-Control-Allow-Origin` on account routes, and the download host in `Content-Security-Policy`.
- Requests: `Origin` and `Referer` from the mirror are sent upstream as the `gizlet.io` origins they stand for, so Better Auth and the account CORS policy accept them.

## Files

| File | Holds |
| --- | --- |
| `nginx.conf.template` | The configuration, for the `http` context (`conf.d`). Needs nginx 1.27.3 or later. |
| `render.sh` | Writes the configuration for one mirror domain to stdout |
| `smoke.sh` | Runs it in Docker in front of the real `gizlet.io` and runs `tests/mirror/*.hurl` |

## Use

```sh
mirror/render.sh gizlet.xyz > /etc/nginx/conf.d/gizlet-mirror.conf
nginx -t && nginx -s reload
```

`render.sh` reads its settings from the environment:

| Variable | Default |
| --- | --- |
| `ORIGIN_DOMAIN` | `gizlet.io` |
| `SSL_CERT`, `SSL_KEY` | `/etc/letsencrypt/live/<mirror>/fullchain.pem`, `privkey.pem` |
| `CA_BUNDLE` (verifies the upstream's certificate) | `/etc/ssl/certs/ca-certificates.crt` |
| `RESOLVER` (DNS for the upstream hosts, re-resolved every 5 minutes) | `1.1.1.1 8.8.8.8` |
| `ACME_ROOT` (webroot for HTTP challenges on port 80) | `/var/www/acme` |
| `HTTPS_PORT`, `HTTP_PORT` | `443`, `80` |

To deploy, point DNS for the mirror domain and its `www`, `api` and `dl` hosts at the server. Then get one certificate for all four names. nginx needs the certificate before it starts, so get the first one with `certbot certonly --standalone -d gizlet.xyz -d www.gizlet.xyz -d api.gizlet.xyz -d dl.gizlet.xyz`. Renewals can use `--webroot -w /var/www/acme`.

Check a rendered configuration with Docker, Hurl and openssl:

```sh
mirror/smoke.sh              # as gizlet.xyz, with a self-signed certificate
```

It sends real requests to `gizlet.io`. They only read, apart from one sign-in with a wrong password.

## Limits

- **GitHub sign-in and linking** do not work on a mirror. The GitHub OAuth app's callback is `https://gizlet.io/v1/auth/callback/github`, so GitHub sends the browser back to `gizlet.io`, where the state cookie the mirror set is missing. Email and password sign-in and the device flow work.
- **Rate limits.** Better Auth limits requests per `cf-connecting-ip`, and Cloudflare sets that to the mirror server's address. All of the mirror's users therefore share one sign-in rate limit.
- **Emails** (password reset) link to `gizlet.io`, because Better Auth's `baseURL` is `SITE_ORIGIN`.
- A session on the mirror is separate from one on `gizlet.io`, since the cookies are per domain.

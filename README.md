# Gizlet

Gizlet turns handhelds into pocket computers. A **gizlet** is one native Linux program or game, written in Rust, Go, Zig, C, Flutter or anything else that builds a native executable, with raylib, Slint or any UI engine. It is released on GitHub and shared by its repository link: `gizlet.io/github.com/<owner>/<repo>`.

- **No review to install.** Anyone with the link can install a gizlet, like a Go module or an npm package.
- **No store tax.** Developers will sell software and services through the platform directly.
- **Open.** This repository is the whole service: registry, downloads and accounts, on Cloudflare.

Search and the featured lists only show gizlets that pass automated checks. Installing by link works for any gizlet that is not blocked.

Start a gizlet from [gizlet/app-template](https://github.com/gizlet/app-template). The OS for handhelds is [gizlet/os](https://github.com/gizlet/os). Plans and open work are tracked in [#1](https://github.com/gizlet/gizlet/issues/1).

## How it works

One Cloudflare Worker serves every host:

| Host | Serves |
| --- | --- |
| `gizlet.io` | Share pages, sign-in, `/device` (approving a console), `/account` |
| `api.gizlet.io` | The JSON API, `/v1/...` |
| `dl.gizlet.io` | Packages and art: `/github.com/<owner>/<repo>/<tag>/<file>` |
| `store.gizlet.io`, `www.gizlet.io` | Redirects to `gizlet.io` |

- **Publishing** (`src/api.ts`, `src/registry.ts`): a release workflow posts a GitHub Actions OIDC token to `POST /v1/publish`. The repository comes from the token, never the body. The Worker reads the release's `gizlet.json` from github.com (`src/github.ts`, validated in `src/schema.ts`) and stores it in D1. A repository is also indexed on first sight, when someone opens its link.
- **Mirroring and checks** run on a Queue (`src/mirror.ts`): each package is streamed from GitHub into R2 with its `sha256` enforced by R2, then checked (`src/check.ts`) without loading it whole, using R2 range reads. A `.gzl` must be a zip with a `manifest.toml` that matches `gizlet.json` (`id`, `version`, `target`) and names an `entry` executable for the package's target (ELF machine on Linux, Mach-O on macOS, PE on Windows). No symlinks, devices, setuid files, absolute or `..` paths, encryption or ZIP64. A release that fails is not served at all; one that passes is `ready`.
- **Visibility** (`gizlets.visibility`): `listed` once the newest ready release passed with no warnings (such as no icon or description), else `unlisted`. Admins can set `listed`, `unlisted` or `blocked` (nothing is served, links included), or hand it back to the checks with `auto`.
- **Downloads** (`src/dl.ts`): from R2, immutable, with `Range` and `X-Checksum-Sha256`. Only the newest `KEEP_MIRRORED_RELEASES` (2) ready releases stay in R2; older downloads redirect to GitHub.
- **Accounts** (`src/auth.ts`): [Better Auth](https://www.better-auth.com) on Postgres ([Neon](https://neon.tech) through Cloudflare Hyperdrive), at `/v1/auth/*` on `gizlet.io` (cookies) and `api.gizlet.io` (bearer tokens). Sign-in with email and password, GitHub, and the OAuth device flow for consoles: the console calls `POST /v1/auth/device/code` with `client_id` `gizlet-os`, shows the code, the user approves it at `gizlet.io/device`, and the console polls `POST /v1/auth/device/token` for a bearer token. Signing in with GitHub never joins an existing email account implicitly; users link GitHub from `/account`. The linked GitHub login ties an account to the gizlets in its repositories (`GET /v1/me/gizlets`).
- **Refresh**: a gizlet's latest release is rechecked when it is viewed after 30 minutes, and by a cron every 6 hours.

## API

| Request | Answer |
| --- | --- |
| `GET /v1/featured` | Hand-picked collections and automatic sections, listed gizlets only |
| `GET /v1/gizlets?q=&category=&target=&tier=&limit=&cursor=` | Search, listed gizlets only |
| `GET /v1/gizlets/github.com/{owner}/{repo}` | One gizlet, any visibility but blocked (indexes it on first sight) |
| `GET /v1/gizlets/github.com/{owner}/{repo}/releases[/{tag}]` | Releases, with `status` (`pending`, `mirroring`, `checking`, `ready`, `failed`), `error` and `warnings` |
| `GET /v1/gizlets/github.com/{owner}/{repo}/install?target=&tier=` | The package to install on a device (`409 not_ready` while checks run) |
| `GET /v1/resolve?url=` | Any way of writing a repository, normalized |
| `POST /v1/publish` | `202` with `status_url`; body `{"tag": "v1.2.3"}` or the tag from the token's ref |
| `/v1/auth/*` | Better Auth: `sign-up/email`, `sign-in/email`, `sign-in/social`, `link-social`, `sign-out`, `device/code`, `device/token`, `device`, `device/approve`, `device/deny`, ... |
| `GET /v1/me`, `GET /v1/me/gizlets` | The signed-in user, and the gizlets in their GitHub repositories |
| `PUT`/`DELETE /v1/admin/collections/{id}`, `POST /v1/admin/gizlets/github.com/{owner}/{repo}/visibility` | Curation, with `Authorization: Bearer $ADMIN_TOKEN` |

Errors are `{"error": {"code", "message"}}`. The release index `gizlet.json` (schema 1) is the one [gizlet/app-template](https://github.com/gizlet/app-template) writes.

## Development

Requires Node 24, pnpm (`corepack enable pnpm`) and [Hurl](https://hurl.dev). No Docker: tests use [PGlite](https://pglite.dev) as Postgres.

```sh
pnpm install
pnpm typecheck
pnpm test:hurl            # the full suite against wrangler dev
pnpm test:hurl 05-auth    # files matching a pattern
```

`pnpm test:hurl` starts the fixture server (`tests/fixtures/server.mjs`: a fake github.com and OIDC issuer serving real `.gzl` zips, good and broken), an in-memory Postgres on port 18789 (`hyperdrive.localConnectionString` in `wrangler.jsonc`) and `wrangler dev` on 18787, applies both sets of migrations and runs `tests/hurl/*.hurl`. The `X-Gizlet-Host` header selects the host (`DEV_HOST_OVERRIDE=1`).

| Path | Holds |
| --- | --- |
| `src/index.ts` | Host routing, queue consumer, cron |
| `src/api.ts`, `src/dl.ts`, `src/site.ts` | The three hosts |
| `src/registry.ts`, `src/mirror.ts`, `src/check.ts` | Indexing, mirroring, static checks, visibility |
| `src/auth.ts` | Better Auth options; one instance and connection per request |
| `migrations/d1/` | The registry (D1) |
| `migrations/pg/` | Accounts (Postgres); `node scripts/pg.ts generate <name>` writes the next one after changing `src/auth.ts` |
| `public/static/` | Stylesheet and scripts of the account pages |
| `tests/hurl/`, `tests/prod/` | Local suite and production smoke checks |

## Credentials and deployment

Credentials are SOPS files encrypted to one age key, as in the old `gizlet/store`:

| File | Contents |
| --- | --- |
| `secrets/deploy.enc.yaml` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DATABASE_URL` (Neon, for migrations) |
| `secrets/worker.enc.yaml` | Worker secrets for `wrangler secret bulk`: `ADMIN_TOKEN`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `POSTMARK_TOKEN` |

The age identity is in the macOS login Keychain (service `io.gizlet.store.sops.age`, account = your user name) and in the repository secret `SOPS_AGE_KEY`. `scripts/sops.sh` uses whichever is available:

```sh
scripts/sops.sh edit secrets/worker.enc.yaml
pnpm cf deploy        # wrangler with the decrypted token
pnpm cf tail
```

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck and the Hurl suite on every pull request. On `main` it decrypts the credentials, applies the D1 and Postgres migrations, updates Worker secrets, deploys and runs `tests/prod`.

Cloudflare resources: Worker `gizlet` with custom domains for the five hosts, D1 `gizlet`, R2 bucket `gizlet-assets`, Queues `gizlet-mirror` and `gizlet-mirror-dlq`, Hyperdrive config for the Neon database (Workers Paid plan). The GitHub OAuth app's callback URL is `https://gizlet.io/v1/auth/callback/github`.

## License

[Apache-2.0](LICENSE)

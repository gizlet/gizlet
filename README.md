# Gizlet

Gizlet turns handhelds into pocket computers. A **gizlet** is one native Linux program or game, written in Rust, Go, Zig, C, Flutter or anything else that builds a native executable, with raylib, Slint or any UI engine. It is released on GitHub and shared by its repository link: `gizlet.io/github.com/<owner>/<repo>`.

- **No review to install.** Anyone with the link can install a gizlet, like a Go module or an npm package.
- **No store tax.** Developers will sell software and services through the platform directly.
- **Open.** This repository is the whole service: registry, downloads and accounts, on Cloudflare.

Search and the featured lists only show gizlets that pass automated checks. Installing by link works for any gizlet that is not blocked.

The OS for handhelds is [gizlet/os](https://github.com/gizlet/os). Plans and open work are tracked in [#1](https://github.com/gizlet/gizlet/issues/1).

## How it works

One Cloudflare Worker serves every host:

| Host | Serves |
| --- | --- |
| `gizlet.io` | The home page, `/explore`, `/install` (desktop downloads, handhelds and how to flash each), `/flash/<handheld>` (redirects to its card writer in gizlet/os), gizlet pages, sign-in, `/device` (approving a console), `/account` |
| `api.gizlet.io` | The JSON API, `/v1/...` |
| `dl.gizlet.io` | Packages and art: `/github.com/<owner>/<repo>/<tag>/<file>` |
| `www.gizlet.io` | Redirects to `gizlet.io` |

- **Describing a gizlet**: its repository has a `gizlet.toml` at the root, and each `.gzl` package carries a `manifest.json` its build generates from it. Both are specified in [docs/gizlet-toml.md](docs/gizlet-toml.md); [tests/fixtures/repos/rocket-snail](tests/fixtures/repos/rocket-snail) is a worked example.
- **Publishing** (`src/api.ts`, `src/registry.ts`): a release workflow posts a GitHub Actions OIDC token to `POST /v1/publish`. The repository comes from the token, never the body. The Worker reads the repository's `gizlet.toml` at the release tag from GitHub (`src/github.ts`, validated in `src/schema.ts`) and stores it in D1. Its packages are the release assets named `<id>-<version>-<target>-<tier>.gzl`, so they are found without listing the release. A publish always indexes the tag again, since its packages may have been rebuilt. A repository is also indexed on first sight, when someone opens its link.
- **Reading GitHub** (`src/github.ts`): where the GitHub App [gizlet-bot](https://github.com/apps/gizlet-bot) is installed, releases, assets and repository files (`gizlet.toml`, art) are read through the REST API with an installation token (asset downloads follow GitHub's short-lived signed URLs); elsewhere, through public github.com and raw.githubusercontent.com URLs with no credentials. A 401, 403 or 404 from the API falls back to the public web. So a **private repository** can be a gizlet once its owner installs the app on it: it is indexed, served and listed like a public one (`private: true` in the API, no `readme_url`), and installing the app is the owner's consent to that. A private repository without the app cannot publish (`403 app_not_installed`, with the install link).
- **Mirroring and checks** run on a Queue (`src/mirror.ts`): each package is streamed from GitHub into R2, which is when its size and `sha256` are learnt, then checked (`src/check.ts`) without loading it whole, using R2 range reads. The art and about pages `gizlet.toml` names are copied from the repository. A `.gzl` must be a zip with a `manifest.json` that matches `gizlet.toml` (`id`, `name`, `version`, `runtime`, `target`, `tier`, `entry`) and whose `entry` is an executable for the package's target: an ELF executable of that machine on Linux, a Mach-O executable of that CPU type (or a universal binary with that slice) on macOS, a PE image of that machine on Windows. Packages are at most 1 GiB; icon, cover and screenshots must be PNG, JPEG or WebP. Entry names must be ASCII or flagged UTF-8, match their local headers, carry no renaming extra field (Info-ZIP Unicode Path), be canonical relative paths (no absolute, empty, `.` or `..` segments) and must not land on the same place as another entry by case or Unicode form. No symlinks, devices, setuid files, encryption or ZIP64. Bytes a malware scan found infected (in any release) fail the release they are mirrored for. A release that fails is not served at all; one that passes is `ready`. Each re-index of a tag bumps the release's `revision`; a job only acts on the revision it was queued for, each mirror attempt writes its own R2 object and the first to finish is recorded with its sha256, so duplicate deliveries never pair one attempt's bytes with another's checksum; deciding a revision deletes the objects of the tag's older revisions, and a cron every 10 minutes queues again any release left in `pending`, `mirroring` or `checking` for 30 minutes.
- **Visibility** (`gizlets.visibility`): `listed` once the newest ready release passed with no warnings (such as no icon or description), else `unlisted`. Admins can set `listed`, `unlisted` or `blocked` (nothing is served, links included), or hand it back to the checks with `auto`.
- **Downloads** (`src/dl.ts`): only files `gizlet.toml` names (its packages once `ready`, and its art under its repository path), from R2. Package URLs from the API carry `?sha256=` and are cached as immutable; a plain package URL is cached for 5 minutes, and one whose sha256 no longer matches is 404. Downloads support `Range` and send `X-Checksum-Sha256`. Only the newest `KEEP_MIRRORED_RELEASES` (2) ready releases stay in R2; older downloads redirect to GitHub (a private repository's to a short-lived signed URL from the app, never cached).
- **Accounts** (`src/auth.ts`): [Better Auth](https://www.better-auth.com) on Postgres ([Neon](https://neon.tech) through Cloudflare Hyperdrive), at `/v1/auth/*` on `gizlet.io` (cookies) and `api.gizlet.io` (bearer tokens). Sign-in with email and password, GitHub, and the OAuth device flow for consoles. An email account has no session until its address is confirmed: sign-up mails a link (valid 24 hours) that confirms it and signs the user in, signing in unconfirmed is refused with `EMAIL_NOT_VERIFIED` and mails a new link, and signing up with a taken address answers like a new sign-up and mails the owner instead. Account mail goes out through Cloudflare Email Sending (the `MAIL` binding) from `hello@gizlet.io`, in the language of the request that caused it. For consoles, the console calls `POST /v1/auth/device/code` with `client_id` `gizlet-os`, shows the code, the user approves it at `gizlet.io/device`, and the console polls `POST /v1/auth/device/token` for a bearer token. Signing in with GitHub never joins an existing email account implicitly; users link GitHub from `/account`. The linked GitHub login ties an account to the gizlets in its repositories (`GET /v1/me/gizlets`).
- **Refresh** (`refreshGizlet` in `src/registry.ts`): every view of a gizlet (its API, share page or downloads) is answered from the registry at once and, when it was last checked at least `REFRESH_AFTER_SECONDS` (120) ago, refreshes it in the background: the repository's casing and privacy, its latest release (a new tag, or a changed `gizlet.toml` at the tag) and its score. The check time is claimed in one conditional `UPDATE` first, so a burst of views refreshes it once. A cron every 6 hours refreshes gizlets nobody viewed.
- **Marks, ratings and score** (`src/score.ts`): `awesome` is set by an admin; `scanned` means the packages of the newest ready release passed a malware scan, which a scanner reports with the admin token (a re-index of the tag clears it). An `infected` report fails the release in one transaction (a mirror job still running cannot mark it ready again) and records its packages' sha256: every other release with the same bytes (another tag or repository) is failed with it, and no later re-index serves them, whatever its `gizlet.toml` says. Signed-in users rate a gizlet 1 to 5 stars, one rating per account; developers cannot rate their own (by linked GitHub login). The `score` (0 to 100) ranks gizlets: 40 for ratings (the mean pulled towards 3 stars by 5 virtual votes), 25 for downloads (`log10(1 + downloads) / 4`, full at 10,000), 15 for passing the checks with no warnings (half with warnings), 10 for `scanned`, 10 for `awesome`. It is recomputed in one SQL statement whenever one of these changes, and on refresh (D1 has no `log10`, so only the download points are computed in the Worker).

## API

| Request | Answer |
| --- | --- |
| `GET /v1/featured` | Hand-picked collections and automatic sections, listed gizlets only |
| `GET /v1/gizlets?q=&category=&target=&tier=&mark=&sort=&limit=&cursor=` | Search, listed gizlets only; `mark` is `awesome` or `scanned`, `sort` is `updated` (default), `score`, `rating` or `downloads` |
| `GET /v1/gizlets/github.com/{owner}/{repo}` | One gizlet, any visibility but blocked (indexes it on first sight). Gizlets carry `marks`, `rating` (`average`, `count`), `score` and `private` |
| `GET /v1/gizlets/github.com/{owner}/{repo}/releases[/{tag}]` | Releases, with `status` (`pending`, `mirroring`, `checking`, `ready`, `failed`), `revision`, `error`, `warnings` and `scan` |
| `GET /v1/gizlets/github.com/{owner}/{repo}/install?target=&tier=` | The package to install on a device (`409 not_ready` while checks run) |
| `GET /v1/resolve?url=` | Any way of writing a repository, normalized |
| `POST /v1/publish` | `202` with `status_url`; body `{"tag": "v1.2.3"}` or the tag from the token's ref |
| `/v1/auth/*` | Better Auth: `sign-up/email`, `sign-in/email`, `verify-email`, `send-verification-email`, `sign-in/social`, `link-social`, `sign-out`, `device/code`, `device/token`, `device`, `device/approve`, `device/deny`, ... |
| `GET /v1/me`, `GET /v1/me/gizlets` | The signed-in user, and the gizlets in their GitHub repositories |
| `GET /v1/me/ratings`; `GET`/`PUT`/`DELETE /v1/me/ratings/github.com/{owner}/{repo}` | The user's ratings; one gizlet's (`PUT` body `{"stars": 1-5}`) |
| `PUT`/`DELETE /v1/admin/collections/{id}`, `POST /v1/admin/gizlets/github.com/{owner}/{repo}/visibility` | Curation, with `Authorization: Bearer $ADMIN_TOKEN` |
| `PUT`/`DELETE /v1/admin/gizlets/github.com/{owner}/{repo}/marks/awesome` | The `awesome` mark (body `{"note"?}`), with the admin token |
| `POST /v1/admin/gizlets/github.com/{owner}/{repo}/releases/{tag}/scan` | A malware scan report, with the admin token: `{"result": "clean" \| "infected", "revision"?, "engine"?, "report_url"?, "note"?}`; `409` when the tag was indexed again since `revision` |

Errors are `{"error": {"code", "message"}}`. A package's `size`, `sha256` and `url` are `null` until it is mirrored.

## Development

Requires Node 24, pnpm (`corepack enable pnpm`) and [Hurl](https://hurl.dev). No Docker: Postgres is [PGlite](https://pglite.dev).

```sh
pnpm install
pnpm dev                  # a local Gizlet with sample gizlets at http://localhost:8787
pnpm typecheck
pnpm test                 # unit tests, the Hurl suite, then the device simulation
pnpm test:unit            # tests/unit only
pnpm test:hurl            # the Hurl suite, then the device simulation
pnpm test:hurl 05-auth    # Hurl files matching a pattern
pnpm test:hurl sim        # the device simulation only
```

`pnpm dev` (`scripts/dev.sh`) needs no network or credentials: GitHub is the fixture server, Postgres is in memory, and a few sample gizlets (Rocket Snail from `tests/fixtures/repos/rocket-snail`, one unlisted, one that fails its checks) are published on start. Every start is fresh. The other hosts are under path prefixes, since every local host is `localhost`: `localhost:8787/_host/api.gizlet.io/v1`, `localhost:8787/_host/dl.gizlet.io/...`. The admin token is `dev-admin`. Account mail is not sent on local runs: it is printed in the log, and `GET /v1/dev/mail?to=<email>` (local runs only) returns the newest one to an address with its link.

`pnpm test:hurl` starts the fixture server (`tests/fixtures/server.mjs`: a fake github.com, raw.githubusercontent.com, api.github.com as gizlet-bot sees it (installed on some repositories, one of them private) and OIDC issuer serving `gizlet.toml` files and real `.gzl` zips, good and broken), an in-memory Postgres on port 18789 (`hyperdrive.localConnectionString` in `wrangler.jsonc`) and `wrangler dev` on 18787, applies both sets of migrations and runs `tests/hurl/*.hurl`, where the `X-Gizlet-Host` header selects the host. The Worker gets the fixture's app key and `REFRESH_AFTER_SECONDS=3`. Then `tests/sim/device.mjs` plays the whole loop as Gizlet OS will: a developer publishes, a player signs up and approves a console's code, and the console signs in with the device flow, opens the share link, downloads the package with a dropped connection and a Range resume, verifies its sha256 and unpacks it.

| Path | Holds |
| --- | --- |
| `src/index.ts` | Host routing, queue consumer, cron |
| `src/api.ts`, `src/dl.ts`, `src/site.ts` | The three hosts |
| `src/i18n.ts` | The site's languages (English, Simplified Chinese, Traditional Chinese, Japanese): `?lang=` (remembered in a `lang` cookie), else the cookie, else `Accept-Language`; every string of the pages and their scripts, and which of a gizlet's own `names`/`descriptions` to show |
| `src/home.ts` | The home page: the featured gizlets as cartridges, a box that opens any repository link (`/open?url=`), and how a gizlet is made |
| `src/explore.ts` | `/explore`: listed gizlets with search and a category filter |
| `src/devices.ts` | `/install`: macOS and Windows downloads, the table of handhelds (supported and requested), and `/install/<id>` with the one-line flash command; `/flash/<id>` redirects to the writer script |
| `src/gizlet-page.ts`, `src/markdown.ts` | A gizlet's page: cover, install link, screenshots, its about page rendered from Markdown, controls and details, in its `color` (served as `/_theme/<hex>.css`, since the CSP allows no inline styles). Everything comes from the Worker and `dl.`, so it works through a mirror |
| `docs/gizlet-toml.md` | `gizlet.toml` and `manifest.json` |
| `src/registry.ts`, `src/mirror.ts`, `src/check.ts` | Indexing, refreshing, mirroring, static checks, visibility |
| `src/github.ts`, `src/pem.ts` | Reading GitHub through gizlet-bot or the public web; the app's key |
| `src/score.ts` | Marks, rating aggregates and the score |
| `src/auth.ts` | Better Auth options; one instance and connection per request |
| `migrations/d1/` | The registry (D1) |
| `migrations/pg/` | Accounts (Postgres); `node scripts/pg.ts generate <name>` writes the next one after changing `src/auth.ts` |
| `public/static/` | The site's stylesheet (no inline styles, as the CSP requires), Schibsted Grotesk in `fonts/` (SIL OFL), the pages' scripts and the icon (`/favicon.ico` is served from here) |
| `design/` | Design notes, and the icon's sources and organization avatar in `icon/` |
| `tests/hurl/`, `tests/sim/`, `tests/prod/` | Local suite, device simulation, production smoke checks |
| `tests/fixtures/` | The fake GitHub; `repos/<name>` are fixture repositories written by hand, served as `fixture-org/<name>` |
| `scripts/dev.sh` | `pnpm dev` |
| `mirror/`, `tests/mirror/` | An nginx reverse proxy that serves every host under another domain (`gizlet.xyz`, `api.gizlet.xyz`, ...), and its checks; see [mirror/README.md](mirror/README.md). Links in account emails use the domain the request came in on, if the `SITE_DOMAINS` repository variable lists it, else `gizlet.io` |

## Credentials and deployment

Credentials are SOPS files encrypted to one age key:

| File | Contents |
| --- | --- |
| `secrets/deploy.enc.yaml` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DATABASE_URL` (Neon's direct endpoint, not `-pooler`, for migrations) |
| `secrets/worker.enc.yaml` | Worker secrets, uploaded with each version by `wrangler deploy --secrets-file`: `ADMIN_TOKEN`, `BETTER_AUTH_SECRET`, and optionally `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

The deploy adds `GITHUB_APP_PRIVATE_KEY` from the organization secret `GIZLET_BOT_PRIVATE_KEY` (gizlet-bot's key, also used by the PR triage); its client id is `GITHUB_APP_CLIENT_ID` in `wrangler.jsonc`. Reading private repositories needs the app's **Contents: read** repository permission, and installing it on other accounts needs the app to be public.

The age identity is in the macOS login Keychain (service `io.gizlet.sops.age`, account = your user name) and in the repository secret `SOPS_AGE_KEY`. `scripts/sops.sh` uses whichever is available:

```sh
scripts/sops.sh edit secrets/worker.enc.yaml
pnpm cf deploy        # wrangler with the decrypted token
pnpm cf tail
```

CI follows the [gizlet/.github](https://github.com/gizlet/.github) setup, as in gizlet/os:

| Workflow | Does |
| --- | --- |
| `triage.yml` | On every pull-request push, gizlet-bot comments `/ci` and `/codex-review` for the head, which starts the two workflows below. A writer's comment with either command runs it again. GitHub-hosted, never checks out PR code. |
| `codex-review.yml` | The `Codex Code Review` check. GitHub-hosted. |
| `ci.yml` | The `CI` check: typecheck, a Worker bundle, the Hurl suite and the device simulation, with no secrets. On `main`, then the deploy: decrypt the credentials, apply the D1 and Postgres migrations, deploy with the Worker secrets and run `tests/prod`. |

Build, test and deploy run on the runner the `RUNNERS` organization variable maps to `linux-x64`, falling back to GitHub's Ubuntu runner. Comment-triggered workflows run their copy on `main`, so a pull request that changes them is tested by the old ones.

Cloudflare resources: Worker `gizlet` with custom domains for the four hosts, D1 `gizlet` and R2 bucket `gizlet-assets` (both in APAC), Queues `gizlet-mirror` and `gizlet-mirror-dlq`, Hyperdrive config `gizlet` for the Neon database (Singapore, direct endpoint) with query caching off, so a revoked session is never served from cache. Email Sending is enabled for `gizlet.io` (its bounce MX and SPF on `cf-bounce.gizlet.io`, DKIM and DMARC in the zone). The GitHub OAuth app's callback URL is `https://gizlet.io/v1/auth/callback/github`.

## License

[Apache-2.0](LICENSE)

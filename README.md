# Gizlet

Gizlet turns handhelds into pocket computers. A **gizlet** is one native Linux program or game, written in Rust, Go, Zig, C, Flutter or anything else that builds a native executable, with raylib, Slint or any UI engine. It is released on GitHub and shared by its repository link: `gizlet.io/github.com/<owner>/<repo>`.

- **No review to install.** Anyone with the link can install a gizlet, like a Go module or an npm package.
- **No store tax.** Developers will sell software and services through the platform directly.
- **Open.** This repository is the whole service: registry, downloads and accounts, on Cloudflare.

Search, Explore and the featured lists only show gizlets that passed automated checks and that an editor approved. Installing by link works for any gizlet that is not blocked.

The OS for handhelds is [gizlet/os](https://github.com/gizlet/os). Plans and open work are tracked in [#1](https://github.com/gizlet/gizlet/issues/1).

## How it works

One Cloudflare Worker serves every host:

| Host | Serves |
| --- | --- |
| `gizlet.io` | The home page, `/explore`, `/install` (desktop downloads, handhelds and how to flash each), `/flash/<handheld>` (redirects to its card writer in gizlet/os), gizlet pages, sign-in, `/device` (approving a console), `/account` (profile, handhelds and devices, your gizlets, short links, security), and short links `/<id>` that redirect to a gizlet's page |
| `api.gizlet.io` | The JSON API, `/v1/...` |
| `dl.gizlet.io` | Packages and art at `/github.com/<owner>/<repo>/<tag>/<file>`, art as handhelds draw it at `/github.com/<owner>/<repo>/<tag>/~device/<icon.png, cover.png or screenshot-N.png>`, and Gizlet OS files at `/releases/<tag>/<file>`. The `manifest.json`, `flash.sh` and `flash.ps1` aliases under `/releases/latest/` redirect to the newest completed OS version. |
| `www.gizlet.io` | Redirects to `gizlet.io` |

- **Describing a gizlet**: its repository has a `gizlet.toml` at the root, and each `.gzl` package carries a `manifest.json` its build generates from it. Both are specified in [docs/gizlet-toml.md](docs/gizlet-toml.md); [tests/fixtures/repos/rocket-snail](tests/fixtures/repos/rocket-snail) is a worked example. A gizlet's `kind` is `app` (games and other foreground programs, presented by `category` `game` or `app`) or `service` (a background program). A manifest of `schema` 1, or with no `schema`, is an app; schema 2 names its `kind`.
- **Publishing** (`src/api.ts`, `src/registry.ts`): a release workflow posts a GitHub Actions OIDC token to `POST /v1/publish`. The repository comes from the token, never the body. The Worker reads the repository's `gizlet.toml` at the release tag from GitHub (`src/github.ts`, validated in `src/schema.ts`) and stores it in D1. Its packages are the release assets named `<id>-<version>-<target>-<tier>.gzl`, so they are found without listing the release. A publish always indexes the tag again, since its packages may have been rebuilt. A repository is also indexed on first sight, when someone opens its link.
- **Reading GitHub** (`src/github.ts`): where the GitHub App [gizlet-bot](https://github.com/apps/gizlet-bot) is installed, releases, assets and repository files (`gizlet.toml`, art) are read through the REST API with an installation token (asset downloads follow GitHub's short-lived signed URLs); elsewhere, through public github.com and raw.githubusercontent.com URLs with no credentials. A 401, 403 or 404 from the API falls back to the public web. So a **private repository** can be a gizlet once its owner installs the app on it: it is indexed, served and listed like a public one (`private: true` in the API, no `readme_url`), and installing the app is the owner's consent to that. A private repository without the app cannot publish (`403 app_not_installed`, with the install link).
- **Mirroring and checks** run on a Queue (`src/mirror.ts`): each package is streamed from GitHub into R2, which is when its size and `sha256` are learnt, then checked (`src/check.ts`) without loading it whole, using R2 range reads. The art and about pages `gizlet.toml` names are copied from the repository, and the icon, cover and screenshots are also scaled and cropped by Cloudflare Images (the `IMAGES` binding, `src/device-art.ts`) into PNGs of 128×128, 640×360 and 640×480 for handhelds, whose launcher decodes only PNG; a release mirrored before that gets them on first request. A `.gzl` must be a zip with a `manifest.json` of schema 1 or 2 that matches `gizlet.toml` (`kind`, `id`, `name`, `version`, `runtime`, `target`, `tier`, `entry`) and whose `entry` is an executable for the package's target: an ELF executable of that machine on Linux, a Mach-O executable of that CPU type (or a universal binary with that slice) on macOS, a PE image of that machine on Windows. Packages are at most 1 GiB; icon, cover and screenshots must be PNG, JPEG or WebP. Entry names must be ASCII or flagged UTF-8, match their local headers, carry no renaming extra field (Info-ZIP Unicode Path), be canonical relative paths (no absolute, empty, `.` or `..` segments) and must not land on the same place as another entry by case or Unicode form. No symlinks, devices, setuid files, encryption or ZIP64. Bytes a malware scan found infected (in any release) fail the release they are mirrored for. A release that fails is not served at all; one that passes is `ready`. Each re-index of a tag bumps the release's `revision`; a job only acts on the revision it was queued for, each mirror attempt writes its own R2 object and the first to finish is recorded with its sha256, so duplicate deliveries never pair one attempt's bytes with another's checksum; deciding a revision deletes the objects of the tag's older revisions, and a cron every 10 minutes queues again any release left in `pending`, `mirroring` or `checking` for 30 minutes.
- **Visibility** (`gizlets.visibility`): `unlisted` (installable by link) until an admin lists it, which is the editorial approval; the checks never list a gizlet themselves. Its `visibility_reason` says why it is not listed: no release has passed its checks yet, the newest ready release's warnings (such as no icon or description), or `awaiting editorial approval`. Admins set `listed`, `unlisted` or `blocked` (nothing is served, links included), which locks the visibility through later releases, or hand it back to the checks with `auto`, which leaves it unlisted until it is approved again. Gizlets listed before approval was required (D1 migration `0005_kinds.sql`) stay listed as approved. Approval only affects listing: a device installs any gizlet that is not blocked from its link.
- **Downloads** (`src/dl.ts`): only files `gizlet.toml` names (its packages once `ready`, and its art under its repository path), from R2. Package URLs from the API carry `?sha256=` and are cached as immutable; a plain package URL is cached for 5 minutes, and one whose sha256 no longer matches is 404. Downloads support `Range` and send `X-Checksum-Sha256`. Only the newest `KEEP_MIRRORED_RELEASES` (2) ready releases stay in R2; older downloads redirect to GitHub (a private repository's to a short-lived signed URL from the app, never cached).
- **Accounts** (`src/auth.ts`): [Better Auth](https://www.better-auth.com) on Postgres ([Neon](https://neon.tech) through Cloudflare Hyperdrive), at `/v1/auth/*` on `gizlet.io` (cookies) and `api.gizlet.io` (bearer tokens). Sign-in with email and password, GitHub, and the OAuth device flow for consoles. An email account has no session until its address is confirmed: sign-up mails a link (valid 24 hours) that confirms it and signs the user in, signing in unconfirmed is refused with `EMAIL_NOT_VERIFIED` and mails a new link, and signing up with a taken address answers like a new sign-up and mails the owner instead. Changing the address (`change-email`) mails a link to the new one, and the email changes once it is opened. Account mail goes out through Cloudflare Email Sending (the `MAIL` binding) from `hello@gizlet.io`, in the language of the request that caused it. For consoles, the console calls `POST /v1/auth/device/code` with `client_id` `gizlet-os`, shows the code, the user approves it at `gizlet.io/device`, and the console polls `POST /v1/auth/device/token` for a bearer token; that session records the client id, so the account lists its devices and can sign each out (`/v1/me/devices`). Signing in with GitHub never joins an existing email account implicitly; users link GitHub from `/account` (scopes `read:user`, `user:email`, `read:org`; the GitHub email may differ from the account's) and can unlink it unless it is their only way to sign in. The linked GitHub login and picture become the account's, and its token ties the account to the gizlets in the repositories of the user and their organizations (`GET /v1/me/gizlets`).
- **The account page** (`src/account.ts`, `public/static/account.js`): rendered on the server for the signed-in user (signed out, it sends them to sign in), in five tabs: profile (name, picture, email), handhelds (the ones they want, drawn as cards, and the devices signed in), their gizlets as cartridges with visibility and how the newest release's checks went, short links, and security (password, sign-in methods, GitHub, sign out).
- **Short links** (`src/links.ts`, the D1 `links` table): `gizlet.io/<id>` redirects to a gizlet's page. An id is 3 to 32 lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit; the site's own paths and some words are reserved. A gizlet has one id at a time, which whoever has admin or maintain on its repository may set (GitHub is asked with their token each time), at least as long as their account's minimum (6 unless an admin changes it; raising it later keeps the ids they have). An id that is changed or removed keeps redirecting for 30 days, and nobody else can take it meanwhile. Links are bound to GitHub's repository id, so they follow a renamed repository and never lead to another repository created at the same path: setting one checks that GitHub's id at the path is the gizlet's (a gizlet indexed from the public web takes that id then), and refreshing a gizlet bound to an id asks GitHub which repository is at its path now, giving the gizlet the new id when it changed. For a private repository, which users' tokens cannot see, gizlet-bot reads the user's role there. A claim checks and writes in one D1 batch, and a unique index keeps one current id per gizlet. A blocked gizlet's links lead nowhere. `/open` and `/v1/resolve` take short links too. Admins can set or take back any id.
- **Wanted handhelds** (`src/devices.ts`, the D1 `wants` table): signed-in users press *I want it* on handhelds Gizlet OS does not support yet, once per account, and press it again to take it back; we port the most wanted first. Signed out, the button opens a dialog whose sign-in comes back to `/install?want=<id>`, which records the want only if this browser started that sign-in from the dialog (the pending want is kept in `localStorage` for a day, as long as a sign-up's email link works), so opening such a link never records a want by itself. The Install table shows how many people want each handheld, and `/account` lists the user's own. A want outlives its handheld becoming supported until it is taken back; a new want for a supported one is `409 supported`.
- **Refresh** (`refreshGizlet` in `src/registry.ts`): every view of a gizlet (its API, share page or downloads) is answered from the registry at once and, when it was last checked at least `REFRESH_AFTER_SECONDS` (120) ago, refreshes it in the background: the repository's casing and privacy, its latest release (a new tag, or a changed `gizlet.toml` at the tag) and its score. The check time is claimed in one conditional `UPDATE` first, so a burst of views refreshes it once. A cron every 6 hours refreshes gizlets nobody viewed.
- **Marks, ratings and score** (`src/score.ts`): `awesome` is set by an admin; `scanned` means the packages of the newest ready release passed a malware scan, which a scanner reports with the admin token (a re-index of the tag clears it). An `infected` report fails the release in one transaction (a mirror job still running cannot mark it ready again) and records its packages' sha256: every other release with the same bytes (another tag or repository) is failed with it, and no later re-index serves them, whatever its `gizlet.toml` says. Signed-in users rate a gizlet 1 to 5 stars, one rating per account; developers cannot rate their own (by linked GitHub login). The `score` (0 to 100) ranks gizlets: 40 for ratings (the mean pulled towards 3 stars by 5 virtual votes), 25 for downloads (`log10(1 + downloads) / 4`, full at 10,000), 15 for passing the checks with no warnings (half with warnings), 10 for `scanned`, 10 for `awesome`. It is recomputed in one SQL statement whenever one of these changes, and on refresh (D1 has no `log10`, so only the download points are computed in the Worker).

## API

| Request | Answer |
| --- | --- |
| `GET /v1/featured?kind=&target=&tier=` | Hand-picked collections and automatic sections, listed gizlets only; a device passes what it can install |
| `GET /v1/gizlets?q=&kind=&category=&target=&tier=&mark=&sort=&limit=&cursor=` | Search, listed gizlets only; `kind` is `app` or `service`, `category` (`game` or `app`) selects apps, `mark` is `awesome` or `scanned`, `sort` is `updated` (default), `score`, `rating` or `downloads` |
| `GET /v1/gizlets/github.com/{owner}/{repo}` | One gizlet, any visibility but blocked (indexes it on first sight). Gizlets carry `kind`, `category` (`null` for a service), `marks`, `rating` (`average`, `count`), `score` and `private` |
| `GET /v1/gizlets/github.com/{owner}/{repo}/releases[/{tag}]` | Releases, with `status` (`pending`, `mirroring`, `checking`, `ready`, `failed`), `revision`, `error`, `warnings` and `scan` |
| `GET /v1/gizlets/github.com/{owner}/{repo}/install?target=&tier=` | The package to install on a device, with the gizlet's `kind` (`409 not_ready` while checks run) |
| `POST /v1/updates` | Body `{"target", "tier", "installed": [{"repo", "id", "version"}]}` (at most 200): each installed gizlet's `status`, `update` (with the `package`), `current`, `not_found`, `blocked`, `no_package` or `id_changed`. Only the repository a gizlet was installed from updates it, and only with the same `id` |
| `GET /v1/resolve?url=` | Any way of writing a repository, normalized; a short link on the site or a `SITE_DOMAINS` mirror (`gizlet.io/<id>`) resolves to its gizlet's repository, with `short_link` |
| `GET /v1/handhelds?status=` | Every handheld (`status` is `supported` or `wanted`), with `wants`, how many accounts want it |
| `POST /v1/publish` | `202` with `status_url`; body `{"tag": "v1.2.3"}` or the tag from the token's ref |
| `/v1/auth/*` | Better Auth: `sign-up/email`, `sign-in/email`, `verify-email`, `send-verification-email`, `sign-in/social`, `link-social`, `sign-out`, `device/code`, `device/token`, `device`, `device/approve`, `device/deny`, ... |
| `GET /v1/me` | The signed-in user (with `link_min_length`), sign-in methods and their account ids (`accounts`, for `unlink-account`) |
| `GET /v1/me/gizlets` | The gizlets in the repositories of the user's GitHub account and organizations, any visibility, each with `checks` (`ready`, `checking`, `failed`, `none`), `release`, `link` and `can_link`; `github` is `ok`, `relink` (GitHub no longer takes the token) or `unavailable` |
| `PUT`/`DELETE /v1/me/gizlets/github.com/{owner}/{repo}/link` | Set (body `{"id"}`) or remove a gizlet's short link: `400 bad_link`, `reserved` or `too_short` (with `min_length`), `403 github_not_linked`, `forbidden` or `github_relink`, `409 taken` |
| `GET /v1/me/devices`; `DELETE /v1/me/devices/{id}` | Consoles signed in through the device flow; sign one out |
| `GET /v1/links/{id}` | Where a short link leads (`repo`, `share_url`, `current`, `expires_at`); a `404` says whether the id is `available` |
| `GET /v1/me/ratings`; `GET`/`PUT`/`DELETE /v1/me/ratings/github.com/{owner}/{repo}` | The user's ratings; one gizlet's (`PUT` body `{"stars": 1-5}`) |
| `GET /v1/me/wants`; `PUT`/`DELETE /v1/me/wants/{handheld}` | The handhelds the user wants, newest first (each with `wanted_at`); want one or take it back, answered with `{"handheld", "wanted", "wants"}` |
| `POST /v1/admin/gizlets/github.com/{owner}/{repo}/visibility` | Listing approval with `Authorization: Bearer $ADMIN_TOKEN` and body `{"visibility": "listed" \| "unlisted" \| "blocked" \| "auto", "reason"?}` |
| `PUT`/`DELETE /v1/admin/gizlets/github.com/{owner}/{repo}/marks/awesome` | The `awesome` mark (body `{"note"?}`), with the admin token |
| `POST /v1/admin/gizlets/github.com/{owner}/{repo}/releases/{tag}/scan` | A malware scan report, with the admin token: `{"result": "clean" \| "infected", "revision"?, "engine"?, "report_url"?, "note"?}`; `409` when the tag was indexed again since `revision` |
| `PUT`/`DELETE /v1/admin/links/{id}` | Set a short link (body `{"repo"}`), whatever its length and whoever has it; or take it back at once. With the admin token |
| `PUT /v1/admin/users/{user id or email}/link-min-length` | An account's shortest short link, body `{"min_length": 3-32}`, with the admin token |

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

`pnpm dev` (`scripts/dev.sh`) needs no network or credentials: GitHub is the fixture server, Postgres is in memory, and a few sample gizlets (Rocket Snail from `tests/fixtures/repos/rocket-snail`, a service, one unlisted, one that fails its checks) are published and approved for listing on start. Every start is fresh. The other hosts are under path prefixes, since every local host is `localhost`: `localhost:8787/_host/api.gizlet.io/v1`, `localhost:8787/_host/dl.gizlet.io/...`. The admin token is `dev-admin`. Account mail is not sent on local runs: it is printed in the log, and `GET /v1/dev/mail?to=<email>` (local runs only) returns the newest one to an address with its link. Linking GitHub on `/account` goes to the fixture's GitHub, which offers its users: `fixture-dev` administers every `fixture-org` repository, `fixture-maintainer` maintains `hello-gizlet`, `fixture-viewer` only reads. On local runs Better Auth's requests to github.com and api.github.com go to the fixture server (`devGithubUrl` in `src/auth.ts`).

`pnpm test:hurl` starts the fixture server (`tests/fixtures/server.mjs`: a fake github.com, raw.githubusercontent.com, api.github.com as gizlet-bot sees it (installed on some repositories, one of them private) and as users of the OAuth app see it, and OIDC issuer serving `gizlet.toml` files and real `.gzl` zips, good and broken), an in-memory Postgres on port 18789 (`hyperdrive.localConnectionString` in `wrangler.jsonc`) and `wrangler dev` on 18787, applies both sets of migrations and runs `tests/hurl/*.hurl`, where the `X-Gizlet-Host` header selects the host. The Worker gets the fixture's app key, the fixture OAuth app and `REFRESH_AFTER_SECONDS=3`. Then `tests/sim/device.mjs` plays the whole loop as Gizlet OS will: a developer publishes, a player signs up and approves a console's code, and the console signs in with the device flow, opens the share link, downloads the package with a dropped connection and a Range resume, verifies its sha256 and unpacks it.

| Path | Holds |
| --- | --- |
| `src/index.ts` | Host routing, queue consumer, cron |
| `src/api.ts`, `src/dl.ts`, `src/site.ts` | The three hosts |
| `src/i18n.ts` | The site's languages (English, Simplified Chinese, Traditional Chinese, Japanese): `?lang=` (remembered in a `lang` cookie), else the cookie, else `Accept-Language`; every string of the pages and their scripts, and which of a gizlet's own `names`/`descriptions` to show |
| `src/home.ts` | The home page: the featured gizlets as cartridges, a box that opens any repository link (`/open?url=`), and how a gizlet is made |
| `src/explore.ts` | `/explore`: listed gizlets with search, a kind filter (Apps, Services) and a category filter for apps (Games, Apps & tools), 24 a page (`EXPLORE_PAGE_SIZE`, 2 in the Hurl suite) |
| `src/devices.ts` | `/install`: macOS and Windows downloads, the table of handhelds (supported, and requested with their want counts), and `/install/<id>` with the one-line flash command; `/flash/<id>` redirects to the writer script |
| `src/gizlet-page.ts`, `src/markdown.ts` | A gizlet's page: cover, install link, screenshots, its about page rendered from Markdown, controls and details, in its `color` (served as `/_theme/<hex>.css`, since the CSP allows no inline styles). Everything comes from the Worker and `dl.`, so it works through a mirror |
| `src/account.ts`, `public/static/account.js` | `/account` and the data behind `/v1/me/gizlets` and `/v1/me/devices` |
| `src/links.ts` | Short links: the id rules, reserved words, claiming and resolving |
| `docs/gizlet-toml.md` | `gizlet.toml` and `manifest.json` |
| `src/registry.ts`, `src/mirror.ts`, `src/check.ts` | Indexing, refreshing, mirroring, static checks, visibility |
| `src/github.ts`, `src/pem.ts` | Reading GitHub through gizlet-bot or the public web, and as a signed-in user (their repositories, organizations and permissions); the app's key |
| `src/score.ts` | Marks, rating aggregates and the score |
| `src/auth.ts` | Better Auth options; one instance and connection per request |
| `migrations/d1/` | The registry (D1) |
| `migrations/pg/` | Accounts (Postgres); `node scripts/pg.ts generate <name>` writes the next one after changing `src/auth.ts` |
| `public/static/` | The site's stylesheet (no inline styles, as the CSP requires), Schibsted Grotesk in `fonts/` (SIL OFL), the pages' scripts and the icon (`/favicon.ico` is served from here) |
| `design/` | Design notes, and the icon's sources and organization avatar in `icon/` |
| `tests/hurl/`, `tests/sim/`, `tests/prod/` | Local suite, device simulation, production smoke checks |
| `tests/fixtures/` | The fake GitHub; `repos/<name>` are fixture repositories written by hand, served as `fixture-org/<name>` |
| `scripts/dev.sh` | `pnpm dev` |

Run a mirror on your own domain with [Gizlet Mirror](https://github.com/gizlet/gizlet-mirror). Account emails use the mirror domain when it is listed in the `SITE_DOMAINS` repository variable and use `gizlet.io` otherwise.

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

## Publishing featured content

Edit the `FEATURED_JSON` repository variable under **Settings → Secrets and variables → Actions → Variables**. The variable follows the same deploy flow as `SITE_DOMAINS`. In **Actions → CI → Run workflow**, select `main` and leave both inputs blank. The workflow validates the JSON before deploying it as a Worker binding. Only repository users with write access or higher can dispatch the workflow.

```json
[
  {
    "id": "hero",
    "title": "Featured",
    "layout": "hero",
    "repos": ["gizlet/little-prince"]
  },
  {
    "id": "staff-picks",
    "title": "Staff picks",
    "titles": { "zh-CN": "编辑精选" },
    "repos": ["gizlet/overeaten", "gizlet/browser"]
  }
]
```

The arrays set collection and repository order. The optional `titles` object supplies translations. Layout defaults to `row` and also accepts `grid` or `hero`, with at most one hero collection. The homepage shows the first eligible hero entry. Repositories must be listed and have a ready release to appear. When the variable is unset or `[]`, the homepage uses its automatic lists and recent hero fallback. The normalized JSON must fit the Worker's 5 KB binding limit.

## License

[Apache-2.0](LICENSE)

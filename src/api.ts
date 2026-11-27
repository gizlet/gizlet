import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { githubAccount, myDevices, myGizlets, myWants, signInMethods, signOutDevice, type AccountUser } from "./account";
import { createAuth, devGithubUrl, devOutbox, siteDomains } from "./auth";
import { featured, getGizlet, gizletDetail, LIST_SORTS, listGizlets, listReleases, packageJson, pickInstall, releaseJson, summary, VISIBILITIES, type GizletRow, type ListSort, type PackageRow, type ReleaseRow } from "./db";
import { findHandheld, HANDHELDS, handheldJson, wantCounts, type Handheld } from "./devices";
import type { Env } from "./env";
import { appCanManage, canManage, githubUser, NotFound, repositoryIdAt, reader, UpstreamError, UserTokenRejected } from "./github";
import { adoptRepositoryId, claimLink, getLink, LINK_MAX, LINK_MIN, linkProblem, minLengthOf, normalizeLinkId, releaseLink, resolveLink, shortLinkIn, shortUrl, type LinkProblem } from "./links";
import { reportInfected } from "./mirror";
import { AuthError, verifyActionsToken } from "./oidc";
import { ensureGizlet, indexRelease, setVisibility } from "./registry";
import { ADMIN_MARKS, MARKS, ratingAverage, rescore, type Mark } from "./score";
import { parseRepoAddress, repoRef, type RepoRef } from "./repo";
import { CATEGORIES, compareVersions, IndexError, KINDS, tierRunsOn, type Category, type Kind, type Tier } from "./schema";

export const VERSION = "2.2.0";

type App = { Bindings: Env };
type C = Context<App>;

export function apiError(c: C, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503, code: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: { code, message, ...extra } }, status);
}

const TARGET = /^[a-z0-9_]+(-[a-z0-9_.]+){2,3}$/;
const TAG = /^[A-Za-z0-9._+-]{1,100}$/;

function ref(c: C): RepoRef | null {
  return repoRef(c.req.param("owner") ?? "", c.req.param("repo") ?? "");
}

/** Run `fn` with a per-request Better Auth instance, closing its connection afterwards. */
export async function withAuth<T>(c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }, fn: (a: ReturnType<typeof createAuth>) => Promise<T>): Promise<T> {
  const a = createAuth(c.env);
  try {
    return await fn(a);
  } finally {
    c.executionCtx.waitUntil(a.close());
  }
}

/** Local runs: the browser goes to the fixture's GitHub authorize page instead of github.com's (devGithubUrl). */
async function devGithubResponse(env: Env, res: Response): Promise<Response> {
  const location = res.headers.get("location");
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  const data = json ? ((await res.clone().json().catch(() => null)) as { url?: unknown } | null) : null;
  const url = typeof data?.url === "string" ? data.url : null;
  if ((!location || devGithubUrl(env, location) === location) && (!url || devGithubUrl(env, url) === url)) return res;
  const out = new Response(url ? JSON.stringify({ ...data, url: devGithubUrl(env, url) }) : res.body, res);
  if (url) out.headers.delete("content-length");
  if (location) out.headers.set("location", devGithubUrl(env, location));
  return out;
}

/** The Better Auth handler, mounted under /v1/auth on gizlet.io and api.gizlet.io. */
export const authHandler = (c: C) =>
  withAuth(c, async ({ auth }) => {
    const res = await auth.handler(c.req.raw);
    return c.env.DEV_HOST_OVERRIDE === "1" ? devGithubResponse(c.env, res) : res;
  });

export const api = new Hono<App>();

// Account routes accept the site's cookies; everything else is public and cookie-free.
const accountCors = cors({
  origin: (origin, c: C) => (origin === c.env.SITE_ORIGIN ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"],
  exposeHeaders: ["set-auth-token"],
  maxAge: 86400,
});
api.use("/v1/auth/*", accountCors);
api.use("/v1/me", accountCors);
api.use("/v1/me/*", accountCors);
api.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/v1/auth/") || path === "/v1/me" || path.startsWith("/v1/me/")) return next();
  return cors({ origin: "*", allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"], maxAge: 86400 })(c, next);
});
api.use("*", async (c, next) => {
  await next();
  if (c.req.method === "GET" && c.res.status < 400 && !c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "public, max-age=30");
});

api.onError((e, c) => {
  if (e instanceof UpstreamError) return apiError(c, 502, "upstream_error", e.message);
  console.error(e);
  return c.json({ error: { code: "internal", message: "internal error" } }, 500);
});
api.notFound((c) => apiError(c, 404, "not_found", `no route for ${c.req.method} ${new URL(c.req.url).pathname}`));

api.get("/", (c) => c.redirect("/v1", 302));
api.get("/v1", (c) =>
  c.json({
    name: "Gizlet API",
    version: VERSION,
    source: "https://github.com/gizlet/gizlet",
    endpoints: [
      "GET /v1/featured",
      "GET /v1/gizlets?q=&kind=&category=&target=&tier=&mark=&sort=&limit=&cursor=",
      "GET /v1/gizlets/github.com/{owner}/{repo}",
      "GET /v1/gizlets/github.com/{owner}/{repo}/releases",
      "GET /v1/gizlets/github.com/{owner}/{repo}/releases/{tag}",
      "GET /v1/gizlets/github.com/{owner}/{repo}/install?target=&tier=",
      "POST /v1/updates",
      "GET /v1/resolve?url=",
      "GET /v1/links/{id}",
      "GET /v1/handhelds?status=",
      "POST /v1/publish",
      "/v1/auth/* (Better Auth: sign-up/email, sign-in/email, sign-in/social, device/code, device/token, ...)",
      "GET /v1/me",
      "GET /v1/me/gizlets",
      "PUT|DELETE /v1/me/gizlets/github.com/{owner}/{repo}/link",
      "GET /v1/me/devices",
      "DELETE /v1/me/devices/{id}",
      "GET /v1/me/ratings",
      "PUT|DELETE /v1/me/ratings/github.com/{owner}/{repo}",
      "GET /v1/me/wants",
      "PUT|DELETE /v1/me/wants/{handheld}",
    ],
  }),
);
api.get("/v1/healthz", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true }, 200, { "cache-control": "no-store" });
});

/** Local runs only: the newest account email to an address, so tests can follow its link. */
api.get("/v1/dev/mail", (c) => {
  if (c.env.DEV_HOST_OVERRIDE !== "1") return apiError(c, 404, "not_found", "no route for GET /v1/dev/mail");
  const to = (c.req.query("to") ?? "").toLowerCase();
  const mail = devOutbox.findLast((m) => m.to === to);
  if (!mail) return apiError(c, 404, "not_found", `no mail to ${to}`);
  return c.json({ ...mail, link: /https?:\/\/\S+/.exec(mail.text)?.[0] ?? null }, 200, { "cache-control": "no-store" });
});

/** Kind, target and tier from the query, as a device names what it can install. */
function deviceFilter(c: C): { kind?: Kind; target?: string; tier?: Tier } | { error: Response } {
  const kind = (c.req.query("kind") || undefined) as Kind | undefined;
  const target = c.req.query("target") || undefined;
  const tier = (c.req.query("tier") || undefined) as Tier | undefined;
  if (kind && !KINDS.includes(kind)) return { error: apiError(c, 400, "bad_request", `kind must be ${KINDS.join(" or ")}`) };
  if (tier && tier !== "lite" && tier !== "full") return { error: apiError(c, 400, "bad_request", "tier must be lite or full") };
  if (target && !TARGET.test(target)) return { error: apiError(c, 400, "bad_request", "target must be a target triple") };
  return { kind, target, tier };
}

api.get("/v1/featured", async (c) => {
  const filter = deviceFilter(c);
  if ("error" in filter) return filter.error;
  return c.json(await featured(c.env, filter));
});

api.get("/v1/gizlets", async (c) => {
  const q = c.req.query("q")?.trim().slice(0, 100) || undefined;
  const category = c.req.query("category") || undefined;
  const mark = c.req.query("mark") || undefined;
  const sort = (c.req.query("sort") || "updated") as ListSort;
  const filter = deviceFilter(c);
  if ("error" in filter) return filter.error;
  const { kind, target, tier } = filter;
  if (mark && !MARKS.includes(mark as Mark)) return apiError(c, 400, "bad_request", `mark must be ${MARKS.join(" or ")}`);
  if (!LIST_SORTS.includes(sort)) return apiError(c, 400, "bad_request", `sort must be ${LIST_SORTS.join(", ")}`);
  if (category && !CATEGORIES.includes(category as Category)) return apiError(c, 400, "bad_request", "category must be game or app");
  if (category && kind === "service") return apiError(c, 400, "bad_request", "category is for apps; services have none");
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "24", 10) || 24, 1), 100);
  const offset = Math.max(Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0, 0);
  const rows = await listGizlets(c.env, { q, kind, category, target, tier, mark, sort, limit: limit + 1, offset });
  return c.json({ gizlets: rows.slice(0, limit).map((g) => summary(c.env, g)), next_cursor: rows.length > limit ? String(offset + limit) : null });
});

/** The gizlet named by the route, indexing it on first sight; any visibility but blocked. */
async function gizletOr404(c: C): Promise<{ gizlet: GizletRow } | { error: Response }> {
  const r = ref(c);
  if (!r) return { error: apiError(c, 400, "bad_request", "not a GitHub repository") };
  const g = await ensureGizlet(c.env, r, c.executionCtx);
  if (!g) {
    const failed = await c.env.DB.prepare("SELECT tag, error FROM releases WHERE repo = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1")
      .bind(r.key)
      .first<{ tag: string; error: string | null }>();
    if (failed) return { error: apiError(c, 404, "failed_checks", `${r.key} has no release that passed its checks; ${failed.tag}: ${failed.error ?? "failed"}`) };
    return { error: apiError(c, 404, "not_found", `${r.key} has no release with a gizlet.toml`) };
  }
  if (g.visibility === "blocked") return { error: apiError(c, 403, "blocked", `${r.key} is blocked: ${g.visibility_reason ?? "removed by Gizlet"}`) };
  return { gizlet: g };
}

const GIZLET = "/v1/gizlets/github.com/:owner/:repo";

api.get(GIZLET, async (c) => {
  const r = await gizletOr404(c);
  if ("error" in r) return r.error;
  return c.json({ ...(await gizletDetail(c.env, r.gizlet)), visibility_reason: r.gizlet.visibility_reason });
});

api.get(`${GIZLET}/releases`, async (c) => {
  const r = await gizletOr404(c);
  if ("error" in r) return r.error;
  return c.json({ releases: await listReleases(c.env, r.gizlet.repo) });
});

/** Release status for publishers: no cache, and never indexes. */
api.get(`${GIZLET}/releases/:tag`, async (c) => {
  const r = ref(c);
  if (!r) return apiError(c, 400, "bad_request", "not a GitHub repository");
  const tag = c.req.param("tag");
  const rel = await c.env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<ReleaseRow>();
  if (!rel) return apiError(c, 404, "not_found", `${r.key} has no indexed release ${tag}`);
  const { results } = await c.env.DB.prepare("SELECT * FROM packages WHERE repo = ? AND tag = ?").bind(r.key, tag).all<PackageRow>();
  const g = await getGizlet(c.env, r.key);
  return c.json({ ...releaseJson(c.env, rel, results), visibility: g?.visibility ?? null, visibility_reason: g?.visibility_reason ?? null }, 200, { "cache-control": "no-store" });
});

api.get(`${GIZLET}/install`, async (c) => {
  const target = c.req.query("target") ?? "";
  const tier = (c.req.query("tier") ?? "lite") as Tier;
  if (!TARGET.test(target)) return apiError(c, 400, "bad_request", "target must be a target triple such as aarch64-unknown-linux-gnu");
  if (tier !== "lite" && tier !== "full") return apiError(c, 400, "bad_request", "tier must be lite or full");
  const r = await gizletOr404(c);
  if ("error" in r) return r.error;
  // A device pins what it installs to GitHub's id for the repository: learn it now if the gizlet
  // was indexed from the public web, which has none. Its releases were not read as that
  // repository's, so the newest is indexed and mirrored again under the id, checked as it is.
  const shown = r.gizlet.latest_tag;
  if (r.gizlet.repository_id == null && shown) {
    const ref = { owner: r.gizlet.owner, name: r.gizlet.name_repo, key: r.gizlet.repo };
    const id = await repositoryIdAt(c.env, ref).catch(() => undefined);
    if (typeof id === "number") {
      r.gizlet = await adoptRepositoryId(c.env, r.gizlet, id);
      await indexRelease(c.env, ref, shown, { repositoryId: id }).catch((e: unknown) => console.error("re-index under the repository id failed", ref.key, e));
    }
  }
  let pkg = await pickInstall(c.env, r.gizlet.repo, target, tier);
  // Only releases indexed under another repository, or under none (from before repository ids, or
  // while GitHub could not say), would fit: index the newest of them again, which mirroring checks
  // against the repository at the path now. Meanwhile the answer is not_ready.
  if (!pkg && r.gizlet.repository_id != null) {
    const stale = await c.env.DB.prepare(
      `SELECT r.tag, r.version, p.tier FROM releases r JOIN packages p ON p.repo = r.repo AND p.tag = r.tag AND p.revision = r.revision
        WHERE r.repo = ? AND p.target = ? AND r.status = 'ready' AND r.repository_id IS NOT ?`,
    )
      .bind(r.gizlet.repo, target, r.gizlet.repository_id)
      .all<{ tag: string; version: string; tier: Tier }>();
    const newest = stale.results.filter((p) => tierRunsOn(p.tier, tier)).sort((a, b) => compareVersions(b.version, a.version))[0];
    if (newest) {
      const ref = { owner: r.gizlet.owner, name: r.gizlet.name_repo, key: r.gizlet.repo };
      await indexRelease(c.env, ref, newest.tag, { repositoryId: r.gizlet.repository_id }).catch((e: unknown) => console.error("re-index under the repository id failed", ref.key, e));
      pkg = await pickInstall(c.env, r.gizlet.repo, target, tier);
    }
  }
  if (!pkg) {
    const pending = await c.env.DB.prepare("SELECT 1 FROM releases WHERE repo = ? AND status IN ('pending', 'mirroring', 'checking')").bind(r.gizlet.repo).first();
    if (pending) return apiError(c, 409, "not_ready", `${r.gizlet.name} is still being checked; try again in a minute`);
    return apiError(c, 404, "no_compatible_package", `${r.gizlet.name} has no package for ${target} (${tier})`);
  }
  // The picked release's id and name: an older release can be the newest one for this target.
  return c.json({ repo: r.gizlet.repo, repository_id: pkg.repository_id, id: pkg.app_id, name: r.gizlet.name, kind: pkg.kind, version: pkg.version, tag: pkg.tag, package: packageJson(c.env, pkg) }, 200, { "cache-control": "no-store" });
});

const MAX_UPDATES = 200;

/**
 * What a device's installed gizlets can update to, in one request. Each entry names the
 * repository the device installed it from and, when the install answer gave one, GitHub's
 * `repository_id` for it. Only that repository updates it (`repository_changed` once its path
 * holds another one), and only with a package whose id is the installed one: another repository
 * claiming the same id, or the repository moving to another id, never replaces an app and
 * reaches its saves. Each `status` is `update` (with the package and the `repository_id` to keep),
 * `current`, `not_found`, `blocked`, `unverified` (installed without a `repository_id`: install it
 * again to update it), `repository_changed`, `no_package` (nothing for this target
 * and tier any more) or `id_changed`. Stale gizlets are refreshed in the background, as views
 * refresh them.
 */
api.post("/v1/updates", async (c) => {
  const body = await c.req.json<{ target?: unknown; tier?: unknown; installed?: unknown }>().catch(() => null);
  const target = body?.target;
  const tier = body?.tier ?? "lite";
  if (typeof target !== "string" || !TARGET.test(target)) return apiError(c, 400, "bad_request", "target must be a target triple such as aarch64-unknown-linux-gnu");
  if (tier !== "lite" && tier !== "full") return apiError(c, 400, "bad_request", "tier must be lite or full");
  if (!Array.isArray(body?.installed) || body.installed.length > MAX_UPDATES) return apiError(c, 400, "bad_request", `installed must be a list of at most ${MAX_UPDATES} {repo, id, version}`);
  const installed: { repo: string; repository_id: number | null; id: string; version: string }[] = [];
  for (const one of body.installed as unknown[]) {
    const { repo, repository_id = null, id, version } = (one ?? {}) as Record<string, unknown>;
    if (typeof repo !== "string" || typeof id !== "string" || typeof version !== "string" || !id || !version) {
      return apiError(c, 400, "bad_request", "each installed gizlet needs repo, id and version");
    }
    if (repository_id !== null && !Number.isSafeInteger(repository_id)) return apiError(c, 400, "bad_request", "repository_id must be GitHub's repository id");
    installed.push({ repo, repository_id: repository_id as number | null, id, version });
  }
  const gizlets = [];
  for (const one of installed) {
    const r = parseRepoAddress(one.repo);
    const base = { repo: r?.key ?? one.repo, repository_id: one.repository_id, id: one.id, installed: one.version };
    // Only gizlets the registry knows: a device installed each from one, so nothing is indexed here.
    const known = r ? await getGizlet(c.env, r.key) : null;
    if (known?.visibility === "blocked") {
      gizlets.push({ ...base, status: "blocked" });
      continue;
    }
    const g = r && known?.latest_tag ? await ensureGizlet(c.env, r, c.executionCtx) : null;
    if (!r || !g) {
      gizlets.push({ ...base, status: "not_found" });
      continue;
    }
    if (g.visibility === "blocked") {
      gizlets.push({ ...base, status: "blocked" });
      continue;
    }
    // Installed without GitHub's id for its repository: nothing says the path still holds it, so
    // it is updated only by installing it again, which the user chooses.
    if (one.repository_id === null) {
      gizlets.push({ ...base, status: "unverified" });
      continue;
    }
    // The path now holds another GitHub repository (the one installed from was renamed or deleted
    // and someone else took its name): it never updates what the device installed.
    if (g.repository_id !== one.repository_id) {
      gizlets.push({ ...base, status: "repository_changed" });
      continue;
    }
    // Checked again in the statement that picks the package, which a publish meanwhile cannot get between.
    const pkg = await pickInstall(c.env, g.repo, target, tier, one.repository_id);
    const s = summary(c.env, g);
    const about = { name: s.name, names: s.names, color: s.color, visibility: s.visibility, device_icon_url: s.device_icon_url };
    if (!pkg) gizlets.push({ ...base, ...about, status: "no_package" });
    else if (pkg.app_id !== one.id) gizlets.push({ ...base, ...about, status: "id_changed", version: pkg.version });
    else if (compareVersions(pkg.version, one.version) <= 0) gizlets.push({ ...base, ...about, status: "current", version: pkg.version });
    else gizlets.push({ ...base, ...about, repository_id: pkg.repository_id, status: "update", version: pkg.version, tag: pkg.tag, kind: pkg.kind, package: packageJson(c.env, pkg) });
  }
  return c.json({ gizlets }, 200, { "cache-control": "no-store" });
});

/** The hosts short links are on: the site's, and its mirrors' (SITE_DOMAINS). */
export const siteHosts = (env: Env) => [new URL(env.SITE_ORIGIN).host.toLowerCase(), ...siteDomains(env)];

/** Any way of writing a repository, or a short link to a gizlet (gizlet.io/<id>). */
api.get("/v1/resolve", async (c) => {
  const url = c.req.query("url") ?? "";
  let r = parseRepoAddress(url);
  const short = r ? null : shortLinkIn(url, siteHosts(c.env));
  if (short) {
    const found = await resolveLink(c.env, short);
    if (!found) return apiError(c, 404, "not_found", `${short} leads nowhere`);
    r = { owner: found.gizlet.owner, name: found.gizlet.name_repo, key: found.gizlet.repo };
  }
  if (!r) return apiError(c, 400, "bad_request", `${JSON.stringify(url.slice(0, 200))} is not a GitHub repository address`);
  return c.json({
    repo: r.key,
    owner: r.owner,
    name: r.name,
    api_url: `${c.env.API_ORIGIN}/v1/gizlets/${r.key}`,
    share_url: `${c.env.SITE_ORIGIN}/${r.key}`,
    github_url: `https://github.com/${r.owner}/${r.name}`,
    ...(short ? { short_link: short } : {}),
  });
});

/** Every handheld we know of, supported or not, with how many accounts want it. */
api.get("/v1/handhelds", async (c) => {
  const status = c.req.query("status");
  if (status !== undefined && status !== "supported" && status !== "wanted") return apiError(c, 400, "bad_request", "status must be supported or wanted");
  const counts = await wantCounts(c.env);
  return c.json({ handhelds: HANDHELDS.filter((h) => !status || h.status === status).map((h) => handheldJson(h, counts.get(h.id) ?? 0)) });
});

api.post("/v1/publish", async (c) => {
  const token = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (!token) return apiError(c, 401, "unauthorized", "send a GitHub Actions OIDC token: Authorization: Bearer <token>");
  let claims;
  try {
    claims = await verifyActionsToken(c.env, token);
  } catch (e) {
    if (e instanceof AuthError) return apiError(c, 401, "unauthorized", e.message);
    throw e;
  }
  const body = await c.req.json<{ tag?: unknown }>().catch(() => ({}) as { tag?: unknown });
  const fromRef = claims.ref.startsWith("refs/tags/") ? claims.ref.slice(10) : undefined;
  const tag = typeof body.tag === "string" && body.tag ? body.tag : fromRef;
  if (!tag || !TAG.test(tag)) return apiError(c, 400, "bad_request", 'body must be {"tag": "v<version>"}');
  const [owner, name] = claims.repository.split("/") as [string, string];
  const r = repoRef(owner, name);
  if (!r) return apiError(c, 400, "bad_request", `unsupported repository ${claims.repository}`);
  const g = await getGizlet(c.env, r.key);
  if (g?.visibility === "blocked") return apiError(c, 403, "blocked", `${r.key} is blocked: ${g.visibility_reason ?? "removed by Gizlet"}`);
  // A private repository is read through the GitHub App, which must be installed on it.
  const src = await reader(c.env, r);
  const isPrivate = !!claims.repository_visibility && claims.repository_visibility !== "public";
  if (isPrivate && src.via !== "app") {
    return apiError(c, 403, "app_not_installed", `${claims.repository} is private: install the ${c.env.GITHUB_APP_SLUG} GitHub App on it so Gizlet can read its releases`, {
      install_url: `https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new`,
    });
  }
  let rel;
  try {
    const info = src.via === "app" ? await src.info() : null;
    rel = await indexRelease(c.env, r, tag, {
      repositoryId: Number(claims.repository_id),
      display: { owner, name },
      force: true,
      reader: src,
      info: info ?? { id: Number(claims.repository_id), owner, name, private: isPrivate },
    });
  } catch (e) {
    if (e instanceof NotFound) return apiError(c, 404, "not_found", e.message);
    if (e instanceof IndexError) return apiError(c, 422, "invalid_index", e.message);
    throw e;
  }
  return c.json(
    {
      repo: r.key,
      tag,
      status: rel.status,
      status_url: `${c.env.API_ORIGIN}/v1/gizlets/${r.key}/releases/${encodeURIComponent(tag)}`,
      share_url: `${c.env.SITE_ORIGIN}/${r.key}`,
    },
    202,
  );
});

// --- Accounts ----------------------------------------------------------------------------------

api.on(["GET", "POST"], "/v1/auth/*", authHandler);

type MeUser = AccountUser;
type AuthPool = ReturnType<typeof createAuth>["pool"];

/** The signed-in user (session cookie or bearer token), or a 401. */
async function signedIn(c: C, fn: (user: MeUser, pool: AuthPool) => Promise<Response>): Promise<Response> {
  return withAuth(c, async ({ auth, pool }) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 401, "unauthorized", "sign in first");
    return fn(session.user as MeUser, pool);
  });
}

const noStore = { "cache-control": "no-store" };

/** The signed-in user (session cookie or `Authorization: Bearer <token>`), with linked sign-in methods. */
api.get("/v1/me", (c) =>
  withAuth(c, async ({ auth, pool }) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 401, "unauthorized", "sign in first");
    const u = session.user as MeUser;
    const accounts = await signInMethods(pool, u.id);
    return c.json(
      {
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          email_verified: u.emailVerified,
          image: u.image ?? null,
          github_login: u.githubLogin ?? null,
          link_min_length: minLengthOf(u.linkMinLength),
          created_at: new Date(u.createdAt).toISOString(),
        },
        sign_in_methods: accounts.map((a) => a.provider),
        accounts,
        session: { expires_at: new Date(session.session.expiresAt).toISOString() },
      },
      200,
      noStore,
    );
  }),
);

/**
 * Gizlets in repositories of the user's linked GitHub account and its organizations, any
 * visibility, with their checks, short link and whether the user may set it (src/account.ts).
 */
api.get("/v1/me/gizlets", (c) => signedIn(c, async (u, pool) => c.json(await myGizlets(c.env, pool, u), 200, noStore)));

// --- Devices: consoles signed in through the device flow --------------------------------------

api.get("/v1/me/devices", (c) => signedIn(c, async (u, pool) => c.json({ devices: await myDevices(pool, u.id) }, 200, noStore)));

/** Sign a device out: its session ends, so its token stops working. */
api.delete("/v1/me/devices/:id", (c) =>
  signedIn(c, async (u, pool) => {
    if (!(await signOutDevice(pool, u.id, c.req.param("id")))) return apiError(c, 404, "not_found", "no such device");
    return c.body(null, 204);
  }),
);

// --- Short links (src/links.ts) ----------------------------------------------------------------

const LINK_MESSAGES: Record<LinkProblem, string> = {
  format: "an id is lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit",
  reserved: "that id is reserved",
  too_short: "that id is too short",
  too_long: `an id has at most ${LINK_MAX} characters`,
};

function linkError(c: C, problem: LinkProblem, min = LINK_MIN) {
  const code = problem === "reserved" ? "reserved" : problem === "too_short" ? "too_short" : "bad_link";
  return apiError(c, 400, code, problem === "too_short" ? `ids need at least ${min} characters` : LINK_MESSAGES[problem], { problem, min_length: min });
}

const linkJson = (c: C, id: string, g: GizletRow) => ({ id, url: shortUrl(c.env, id), repo: g.repo, share_url: `${c.env.SITE_ORIGIN}/${g.repo}` });

/** Where a short link leads. A 404 says whether the id could be claimed (`available`). */
api.get("/v1/links/:id", async (c) => {
  const id = normalizeLinkId(c.req.param("id"));
  const problem = linkProblem(id);
  if (problem) return linkError(c, problem);
  const r = await resolveLink(c.env, id);
  if (!r) {
    const held = await getLink(c.env, id);
    const available = !held || (held.expires_at !== null && held.expires_at <= Date.now());
    return apiError(c, 404, "not_found", `${id} leads nowhere`, { available });
  }
  const expires = r.link.expires_at;
  return c.json({ ...linkJson(c, id, r.gizlet), current: expires === null, expires_at: expires ? new Date(expires).toISOString() : null }, 200, noStore);
});

const MY_LINK = "/v1/me/gizlets/github.com/:owner/:repo/link";

/**
 * The gizlet the route names, if the user may set its link now: admin or maintain on GitHub, asked
 * live: with the user's token, or for a private repository (which that token cannot see) through
 * the app installed on it. A gizlet indexed without GitHub's repository id (read from the public
 * web) takes the id GitHub just gave, so its links are bound to the repository rather than its path.
 */
async function managedGizlet(c: C, u: MeUser, pool: AuthPool): Promise<{ gizlet: GizletRow } | { error: Response }> {
  const r = ref(c);
  if (!r) return { error: apiError(c, 400, "bad_request", "not a GitHub repository") };
  const g = await getGizlet(c.env, r.key);
  if (!g) return { error: apiError(c, 404, "not_found", `${r.key} is not a gizlet`) };
  if (g.visibility === "blocked") return { error: apiError(c, 403, "blocked", `${r.key} is blocked`) };
  const account = u.githubLogin ? await githubAccount(pool, u.id) : null;
  if (!account) return { error: apiError(c, 403, "github_not_linked", "link GitHub first") };
  let id: number | null;
  const repo = { owner: g.owner, name: g.name_repo, key: g.repo };
  try {
    id = await canManage(c.env, account.token, repo, g.repository_id ?? null);
    if (id === null && g.private === 1) {
      // The app is asked by login, which GitHub lets people change and others then take: use the
      // login the token's owner has now, once GitHub's id for them is the linked account's.
      const me = await githubUser(c.env, account.token);
      if (String(me.id) === account.githubId) id = await appCanManage(c.env, repo, me.login, g.repository_id ?? null);
    }
  } catch (e) {
    if (e instanceof UserTokenRejected) return { error: apiError(c, 403, "github_relink", "GitHub no longer accepts the linked account; link GitHub again") };
    throw e;
  }
  if (id === null) return { error: apiError(c, 403, "forbidden", `only admins and maintainers of ${g.owner}/${g.name_repo} can set its short link`) };
  return { gizlet: await adoptRepositoryId(c.env, g, id) };
}

/** Body: {"id": "<short id>"}. Sets the gizlet's short link; its previous one keeps working for 30 days. */
api.put(MY_LINK, (c) =>
  signedIn(c, async (u, pool) => {
    const b = await c.req.json<{ id?: unknown }>().catch(() => null);
    if (typeof b?.id !== "string") return apiError(c, 400, "bad_request", 'body must be {"id": "<short id>"}');
    const id = normalizeLinkId(b.id);
    const min = minLengthOf(u.linkMinLength);
    const problem = linkProblem(id, min);
    if (problem) return linkError(c, problem, min);
    const m = await managedGizlet(c, u, pool);
    if ("error" in m) return m.error;
    const res = await claimLink(c.env, m.gizlet, id, u.id);
    if (!res.ok) return apiError(c, 409, "taken", `${id} is taken`);
    return c.json(linkJson(c, id, m.gizlet), 200, noStore);
  }),
);

/** Remove the gizlet's short link; it keeps working, and stays the gizlet's, for 30 days. */
api.delete(MY_LINK, (c) =>
  signedIn(c, async (u, pool) => {
    const m = await managedGizlet(c, u, pool);
    if ("error" in m) return m.error;
    const id = await releaseLink(c.env, m.gizlet);
    if (!id) return apiError(c, 404, "not_found", `${m.gizlet.repo} has no short link`);
    return c.body(null, 204);
  }),
);

// --- Ratings -----------------------------------------------------------------------------------

const ratingOf = (g: Pick<GizletRow, "rating_count" | "rating_sum">) => ({ average: ratingAverage(g.rating_count, g.rating_sum), count: g.rating_count });

/** The user's ratings, newest first. */
api.get("/v1/me/ratings", (c) =>
  signedIn(c, async (u) => {
    const { results } = await c.env.DB.prepare("SELECT repo, stars, updated_at FROM ratings WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200")
      .bind(u.id)
      .all<{ repo: string; stars: number; updated_at: number }>();
    return c.json({ ratings: results.map((r) => ({ repo: r.repo, stars: r.stars, updated_at: new Date(r.updated_at).toISOString() })) }, 200, { "cache-control": "no-store" });
  }),
);

const RATING = "/v1/me/ratings/github.com/:owner/:repo";

/** The gizlet a rating is for: indexed, released and not blocked. */
async function rateable(c: C): Promise<{ gizlet: GizletRow } | { error: Response }> {
  const r = ref(c);
  if (!r) return { error: apiError(c, 400, "bad_request", "not a GitHub repository") };
  const g = await getGizlet(c.env, r.key);
  if (!g?.latest_tag) return { error: apiError(c, 404, "not_found", `${r.key} is not a gizlet`) };
  if (g.visibility === "blocked") return { error: apiError(c, 403, "blocked", `${r.key} is blocked`) };
  return { gizlet: g };
}

api.get(RATING, (c) =>
  signedIn(c, async (u) => {
    const r = await rateable(c);
    if ("error" in r) return r.error;
    const mine = await c.env.DB.prepare("SELECT stars FROM ratings WHERE repo = ? AND user_id = ?").bind(r.gizlet.repo, u.id).first<{ stars: number }>();
    return c.json({ repo: r.gizlet.repo, stars: mine?.stars ?? null, rating: ratingOf(r.gizlet) }, 200, { "cache-control": "no-store" });
  }),
);

/** Body: {"stars": 1-5}. One rating per account; rating again replaces it. Developers cannot rate their own gizlets. */
api.put(RATING, (c) =>
  signedIn(c, async (u) => {
    const r = await rateable(c);
    if ("error" in r) return r.error;
    const b = await c.req.json<{ stars?: unknown }>().catch(() => null);
    const stars = b?.stars;
    if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) return apiError(c, 400, "bad_request", 'body must be {"stars": 1-5}');
    if (u.githubLogin && u.githubLogin.toLowerCase() === r.gizlet.owner.toLowerCase()) return apiError(c, 403, "own_gizlet", "you cannot rate your own gizlet");
    const now = Date.now();
    await c.env.DB.prepare(
      "INSERT INTO ratings (repo, user_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo, user_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at",
    )
      .bind(r.gizlet.repo, u.id, stars, now, now)
      .run();
    await rescore(c.env, r.gizlet.repo);
    const g = (await getGizlet(c.env, r.gizlet.repo))!;
    return c.json({ repo: g.repo, stars, rating: ratingOf(g), score: g.score }, 200, { "cache-control": "no-store" });
  }),
);

api.delete(RATING, (c) =>
  signedIn(c, async (u) => {
    const r = ref(c);
    if (!r) return apiError(c, 400, "bad_request", "not a GitHub repository");
    await c.env.DB.prepare("DELETE FROM ratings WHERE repo = ? AND user_id = ?").bind(r.key, u.id).run();
    await rescore(c.env, r.key);
    return c.body(null, 204);
  }),
);

// --- Wants: handhelds people ask Gizlet OS to support -------------------------------------------

/** The handhelds the user wants, newest first. */
api.get("/v1/me/wants", (c) => signedIn(c, async (u) => c.json({ wants: await myWants(c.env, u.id) }, 200, noStore)));

const WANT = "/v1/me/wants/:handheld";

async function wantState(c: C, h: Handheld, wanted: boolean) {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM wants WHERE handheld = ?").bind(h.id).first<{ n: number }>();
  return c.json({ handheld: h.id, wanted, wants: row?.n ?? 0 }, 200, { "cache-control": "no-store" });
}

/** Want a handheld that is not supported yet. Wanting it again changes nothing. */
api.put(WANT, (c) =>
  signedIn(c, async (u) => {
    const h = findHandheld(c.req.param("handheld"));
    if (!h) return apiError(c, 404, "not_found", `no handheld ${c.req.param("handheld")}; see GET /v1/handhelds`);
    if (h.status === "supported") return apiError(c, 409, "supported", `${h.name} is supported already: ${c.env.SITE_ORIGIN}/install/${h.id}`);
    await c.env.DB.prepare("INSERT INTO wants (handheld, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT (handheld, user_id) DO NOTHING").bind(h.id, u.id, Date.now()).run();
    return wantState(c, h, true);
  }),
);

/** Take a want back, also once the handheld is supported. */
api.delete(WANT, (c) =>
  signedIn(c, async (u) => {
    const h = findHandheld(c.req.param("handheld"));
    if (!h) return apiError(c, 404, "not_found", `no handheld ${c.req.param("handheld")}; see GET /v1/handhelds`);
    await c.env.DB.prepare("DELETE FROM wants WHERE handheld = ? AND user_id = ?").bind(h.id, u.id).run();
    return wantState(c, h, false);
  }),
);

// --- Curation (bearer ADMIN_TOKEN) -------------------------------------------------------------

api.use("/v1/admin/*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const got = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
  if (!expected || !(await timingSafeEqual(got, expected))) return apiError(c, 401, "unauthorized", "admin token required");
  await next();
});

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

/** Body: {"visibility": "listed" | "unlisted" | "blocked" | "auto", "reason"?: string}. */
api.post("/v1/admin/gizlets/github.com/:owner/:repo/visibility", async (c) => {
  const r = ref(c);
  if (!r || !(await getGizlet(c.env, r.key))) return apiError(c, 404, "not_found", "gizlet is not indexed");
  const b = await c.req.json<{ visibility?: string; reason?: unknown }>().catch(() => null);
  const v = b?.visibility;
  if (v !== "auto" && !VISIBILITIES.includes(v as (typeof VISIBILITIES)[number])) return apiError(c, 400, "bad_request", "visibility must be listed, unlisted, blocked or auto");
  const reason = typeof b?.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 500) : null;
  await setVisibility(c.env, r.key, v as "listed" | "unlisted" | "blocked" | "auto", reason);
  const g = (await getGizlet(c.env, r.key))!;
  return c.json({ repo: g.repo, visibility: g.visibility, visibility_reason: g.visibility_reason, locked: g.visibility_locked === 1 });
});

const ADMIN_GIZLET = "/v1/admin/gizlets/github.com/:owner/:repo";

/**
 * Set a short link by hand. Body: {"repo": "<GitHub repository address>"}. Any valid id, of any
 * length from LINK_MIN; one live for another gizlet moves. The gizlet's previous id is held 30 days.
 */
api.put("/v1/admin/links/:id", async (c) => {
  const id = normalizeLinkId(c.req.param("id"));
  const problem = linkProblem(id);
  if (problem) return linkError(c, problem);
  const b = await c.req.json<{ repo?: unknown }>().catch(() => null);
  const r = typeof b?.repo === "string" ? parseRepoAddress(b.repo) : null;
  if (!r) return apiError(c, 400, "bad_request", 'body must be {"repo": "github.com/<owner>/<repo>"}');
  let g = await getGizlet(c.env, r.key);
  if (!g) return apiError(c, 404, "not_found", "gizlet is not indexed");
  // Bound to the repository, not its path, wherever GitHub says which it is.
  if (g.repository_id == null) {
    const repositoryId = await repositoryIdAt(c.env, r);
    if (typeof repositoryId === "number") g = await adoptRepositoryId(c.env, g, repositoryId);
  }
  await claimLink(c.env, g, id, null, true);
  return c.json(linkJson(c, id, g));
});

/** Take a short link back at once: it stops working and anyone may claim it. */
api.delete("/v1/admin/links/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM links WHERE id = ?").bind(normalizeLinkId(c.req.param("id"))).run();
  if (!res.meta.changes) return apiError(c, 404, "not_found", "no such link");
  return c.body(null, 204);
});

/**
 * An account's shortest short link. Body: {"min_length": 3-32}. The account is named by its user
 * id, or by its email. Ids it already has stay.
 */
api.put("/v1/admin/users/:user/link-min-length", async (c) => {
  const b = await c.req.json<{ min_length?: unknown }>().catch(() => null);
  const n = b?.min_length;
  if (typeof n !== "number" || !Number.isInteger(n) || n < LINK_MIN || n > LINK_MAX) return apiError(c, 400, "bad_request", `min_length must be ${LINK_MIN}-${LINK_MAX}`);
  const who = c.req.param("user");
  return withAuth(c, async ({ pool }) => {
    const { rows } = await pool.query<{ id: string; email: string; linkMinLength: number }>(
      `UPDATE "user" SET "linkMinLength" = $1, "updatedAt" = now() WHERE ${who.includes("@") ? "lower(email) = lower($2)" : "id = $2"} RETURNING id, email, "linkMinLength"`,
      [n, who],
    );
    if (!rows[0]) return apiError(c, 404, "not_found", "no such user");
    return c.json({ user_id: rows[0].id, email: rows[0].email, link_min_length: rows[0].linkMinLength });
  });
});

/** Set a mark by hand (awesome). Body: {"note"?: string}. */
api.put(`${ADMIN_GIZLET}/marks/:mark`, async (c) => {
  const r = ref(c);
  if (!r || !(await getGizlet(c.env, r.key))) return apiError(c, 404, "not_found", "gizlet is not indexed");
  const mark = c.req.param("mark") as Mark;
  if (!ADMIN_MARKS.includes(mark)) {
    return apiError(c, 400, "bad_request", MARKS.includes(mark) ? `${mark} follows the release scans; report one at .../releases/{tag}/scan` : `mark must be ${ADMIN_MARKS.join(" or ")}`);
  }
  const b = await c.req.json<{ note?: unknown }>().catch(() => ({}) as { note?: unknown });
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  await c.env.DB.prepare("INSERT INTO marks (repo, mark, note, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (repo, mark) DO UPDATE SET note = excluded.note")
    .bind(r.key, mark, note, Date.now())
    .run();
  await rescore(c.env, r.key);
  const g = (await getGizlet(c.env, r.key))!;
  return c.json({ repo: g.repo, marks: JSON.parse(g.marks) as string[], score: g.score });
});

api.delete(`${ADMIN_GIZLET}/marks/:mark`, async (c) => {
  const r = ref(c);
  if (!r || !(await getGizlet(c.env, r.key))) return apiError(c, 404, "not_found", "gizlet is not indexed");
  await c.env.DB.prepare("DELETE FROM marks WHERE repo = ? AND mark = ?").bind(r.key, c.req.param("mark")).run();
  await rescore(c.env, r.key);
  const g = (await getGizlet(c.env, r.key))!;
  return c.json({ repo: g.repo, marks: JSON.parse(g.marks) as string[], score: g.score });
});

/**
 * A malware scan of a release's packages, from a scanner. Body: {"result": "clean" | "infected",
 * "revision"?: n, "engine"?, "report_url"?, "note"?}. A clean scan of the newest ready release
 * marks the gizlet `scanned`; an infected one fails the release, so nothing of it is served.
 * A re-index of the tag (a new revision) clears the scan.
 */
api.post(`${ADMIN_GIZLET}/releases/:tag/scan`, async (c) => {
  const r = ref(c);
  if (!r) return apiError(c, 404, "not_found", "gizlet is not indexed");
  const tag = c.req.param("tag");
  const rel = await c.env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<ReleaseRow>();
  if (!rel) return apiError(c, 404, "not_found", `${r.key} has no indexed release ${tag}`);
  const b = await c.req.json<{ result?: unknown; revision?: unknown; engine?: unknown; report_url?: unknown; note?: unknown }>().catch(() => null);
  if (!b || (b.result !== "clean" && b.result !== "infected")) return apiError(c, 400, "bad_request", "result must be clean or infected");
  if (b.revision !== undefined && b.revision !== rel.revision) return apiError(c, 409, "revision_changed", `${tag} is at revision ${rel.revision} now; scan it again`, { revision: rel.revision });
  if (b.result === "clean" && rel.status !== "ready") return apiError(c, 409, "not_ready", `${tag} is ${rel.status}; only a ready release can be scanned clean`);
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const reportUrl = str(b.report_url, 500);
  if (reportUrl && !/^https:\/\//.test(reportUrl)) return apiError(c, 400, "bad_request", "report_url must be https");
  const report = { engine: str(b.engine, 100), report_url: reportUrl, note: str(b.note, 500), scanned_at: new Date().toISOString() };
  const job = { repo: r.key, tag, revision: rel.revision };
  let recorded: boolean;
  if (b.result === "infected") {
    recorded = await reportInfected(c.env, job, JSON.stringify(report), `malware scan${report.engine ? ` (${report.engine})` : ""}: ${report.note ?? "infected"}`);
  } else {
    const res = await c.env.DB.prepare("UPDATE releases SET scan = 'clean', scan_report = ? WHERE repo = ? AND tag = ? AND revision = ? AND status = 'ready'")
      .bind(JSON.stringify(report), r.key, tag, rel.revision)
      .run();
    recorded = res.meta.changes > 0;
    if (recorded) await rescore(c.env, r.key);
  }
  if (!recorded) return apiError(c, 409, "revision_changed", `${tag} was indexed again or changed state; scan it again`);
  const fresh = (await c.env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<ReleaseRow>())!;
  const { results } = await c.env.DB.prepare("SELECT * FROM packages WHERE repo = ? AND tag = ?").bind(r.key, tag).all<PackageRow>();
  const g = await getGizlet(c.env, r.key);
  return c.json({ ...releaseJson(c.env, fresh, results), marks: g ? (JSON.parse(g.marks) as string[]) : [] });
});

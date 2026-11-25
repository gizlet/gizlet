import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { featured, getGizlet, gizletDetail, listGizlets, listReleases, packageJson, pickInstall, releaseJson, summary, VISIBILITIES, type GizletRow, type PackageRow, type ReleaseRow } from "./db";
import type { Env } from "./env";
import { NotFound, UpstreamError } from "./github";
import { AuthError, verifyActionsToken } from "./oidc";
import { ensureGizlet, indexRelease, setVisibility } from "./registry";
import { parseRepoAddress, repoRef, type RepoRef } from "./repo";
import { IndexError, type Tier } from "./schema";

export const VERSION = "2.0.0";

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
export async function withAuth<T>(c: C, fn: (a: ReturnType<typeof createAuth>) => Promise<T>): Promise<T> {
  const a = createAuth(c.env);
  try {
    return await fn(a);
  } finally {
    c.executionCtx.waitUntil(a.close());
  }
}

/** The Better Auth handler, mounted under /v1/auth on gizlet.io and api.gizlet.io. */
export const authHandler = (c: C) => withAuth(c, ({ auth }) => auth.handler(c.req.raw));

export const api = new Hono<App>();

// Account routes accept the site's cookies; everything else is public and cookie-free.
const accountCors = cors({
  origin: (origin, c: C) => (origin === c.env.SITE_ORIGIN ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
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
      "GET /v1/gizlets?q=&category=&target=&tier=&limit=&cursor=",
      "GET /v1/gizlets/github.com/{owner}/{repo}",
      "GET /v1/gizlets/github.com/{owner}/{repo}/releases",
      "GET /v1/gizlets/github.com/{owner}/{repo}/releases/{tag}",
      "GET /v1/gizlets/github.com/{owner}/{repo}/install?target=&tier=",
      "GET /v1/resolve?url=",
      "POST /v1/publish",
      "/v1/auth/* (Better Auth: sign-up/email, sign-in/email, sign-in/social, device/code, device/token, ...)",
      "GET /v1/me",
      "GET /v1/me/gizlets",
    ],
  }),
);
api.get("/v1/healthz", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true }, 200, { "cache-control": "no-store" });
});

api.get("/v1/featured", async (c) => c.json(await featured(c.env)));

api.get("/v1/gizlets", async (c) => {
  const q = c.req.query("q")?.trim().slice(0, 100) || undefined;
  const category = c.req.query("category") || undefined;
  const target = c.req.query("target") || undefined;
  const tier = c.req.query("tier") || undefined;
  if (category && category !== "game" && category !== "app") return apiError(c, 400, "bad_request", "category must be game or app");
  if (tier && tier !== "lite" && tier !== "full") return apiError(c, 400, "bad_request", "tier must be lite or full");
  if (target && !TARGET.test(target)) return apiError(c, 400, "bad_request", "target must be a target triple");
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "24", 10) || 24, 1), 100);
  const offset = Math.max(Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0, 0);
  const rows = await listGizlets(c.env, { q, category, target, tier, limit: limit + 1, offset });
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
    return { error: apiError(c, 404, "not_found", `${r.key} has no release with a gizlet.json; see https://github.com/gizlet/app-template`) };
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
  const pkg = await pickInstall(c.env, r.gizlet.repo, target, tier);
  if (!pkg) {
    const pending = await c.env.DB.prepare("SELECT 1 FROM releases WHERE repo = ? AND status IN ('pending', 'mirroring', 'checking')").bind(r.gizlet.repo).first();
    if (pending) return apiError(c, 409, "not_ready", `${r.gizlet.name} is still being checked; try again in a minute`);
    return apiError(c, 404, "no_compatible_package", `${r.gizlet.name} has no package for ${target} (${tier})`);
  }
  return c.json({ repo: r.gizlet.repo, id: r.gizlet.app_id, name: r.gizlet.name, version: pkg.version, tag: pkg.tag, package: packageJson(c.env, pkg) }, 200, { "cache-control": "no-store" });
});

api.get("/v1/resolve", (c) => {
  const url = c.req.query("url") ?? "";
  const r = parseRepoAddress(url);
  if (!r) return apiError(c, 400, "bad_request", `${JSON.stringify(url.slice(0, 200))} is not a GitHub repository address`);
  return c.json({
    repo: r.key,
    owner: r.owner,
    name: r.name,
    api_url: `${c.env.API_ORIGIN}/v1/gizlets/${r.key}`,
    share_url: `${c.env.SITE_ORIGIN}/${r.key}`,
    github_url: `https://github.com/${r.owner}/${r.name}`,
  });
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
  let rel;
  try {
    rel = await indexRelease(c.env, r, tag, { repositoryId: Number(claims.repository_id), display: { owner, name }, retryFailed: true });
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

interface MeUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  githubLogin?: string | null;
  createdAt: Date;
}

/** The signed-in user (session cookie or `Authorization: Bearer <token>`), with linked sign-in methods. */
api.get("/v1/me", (c) =>
  withAuth(c, async ({ auth, pool }) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 401, "unauthorized", "sign in first");
    const u = session.user as MeUser;
    const { rows } = await pool.query<{ providerId: string; accountId: string }>(`SELECT "providerId", "accountId" FROM account WHERE "userId" = $1 ORDER BY "createdAt"`, [u.id]);
    return c.json(
      {
        user: { id: u.id, name: u.name, email: u.email, email_verified: u.emailVerified, image: u.image ?? null, github_login: u.githubLogin ?? null, created_at: new Date(u.createdAt).toISOString() },
        sign_in_methods: rows.map((a) => (a.providerId === "credential" ? "email" : a.providerId)),
        session: { expires_at: new Date(session.session.expiresAt).toISOString() },
      },
      200,
      { "cache-control": "no-store" },
    );
  }),
);

/** Gizlets in repositories owned by the user's linked GitHub account, including unlisted ones. */
api.get("/v1/me/gizlets", (c) =>
  withAuth(c, async ({ auth }) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 401, "unauthorized", "sign in first");
    const login = (session.user as MeUser).githubLogin;
    if (!login) return c.json({ github_login: null, gizlets: [] }, 200, { "cache-control": "no-store" });
    const rows = await listGizlets(c.env, { owner: login, all: true, limit: 100, offset: 0 });
    return c.json(
      { github_login: login, gizlets: rows.map((g) => ({ ...summary(c.env, g), visibility_reason: g.visibility_reason })) },
      200,
      { "cache-control": "no-store" },
    );
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

api.put("/v1/admin/collections/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return apiError(c, 400, "bad_request", "collection id must be [a-z0-9-]");
  const b = await c.req.json<{ title?: string; titles?: Record<string, string>; layout?: string; position?: number; repos?: string[] }>().catch(() => null);
  if (!b || typeof b.title !== "string" || !Array.isArray(b.repos)) return apiError(c, 400, "bad_request", "body needs title and repos");
  const layout = b.layout ?? "row";
  if (!["hero", "row", "grid"].includes(layout)) return apiError(c, 400, "bad_request", "layout must be hero, row or grid");
  const repos = b.repos.map((x) => parseRepoAddress(String(x)));
  if (repos.some((x) => !x)) return apiError(c, 400, "bad_request", "repos must be GitHub repository addresses");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO collections (id, title, titles, layout, position) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, titles = excluded.titles, layout = excluded.layout, position = excluded.position",
    ).bind(id, b.title, JSON.stringify(b.titles ?? {}), layout, b.position ?? 50),
    c.env.DB.prepare("DELETE FROM collection_items WHERE collection_id = ?").bind(id),
    ...repos.map((x, i) => c.env.DB.prepare("INSERT OR IGNORE INTO collection_items (collection_id, repo, position) VALUES (?, ?, ?)").bind(id, x!.key, i)),
  ]);
  return c.json({ id, title: b.title, layout, repos: repos.map((x) => x!.key) });
});

api.delete("/v1/admin/collections/:id", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_items WHERE collection_id = ?").bind(c.req.param("id")),
    c.env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(c.req.param("id")),
  ]);
  return c.body(null, 204);
});

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

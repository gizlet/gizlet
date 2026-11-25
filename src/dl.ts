/** dl.gizlet.io: package and art downloads, from R2 or else GitHub. */
import { Hono, type Context } from "hono";
import { dlUrl, pickInstall, type ReleaseRow } from "./db";
import type { Env } from "./env";
import { assetUrl } from "./github";
import { contentType, r2Key } from "./mirror";
import { ensureGizlet } from "./registry";
import { repoRef } from "./repo";
import { isAssetName, type Tier } from "./schema";

type App = { Bindings: Env };
export const dl = new Hono<App>();

const TAG = /^[A-Za-z0-9._+-]{1,100}$/;
const TARGET = /^[a-z0-9_]+(-[a-z0-9_.]+){2,3}$/;

dl.get("/", (c) => c.redirect(c.env.SITE_ORIGIN, 302));

/** Serve an R2 object with Range, conditional and immutable caching headers; null when it is not in R2. */
async function fromR2(c: Context<App>, key: string, file: string, onDownload: () => void): Promise<Response | null> {
  const obj = await c.env.BUCKET.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) return null;
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");
  if (!headers.has("content-type")) headers.set("content-type", contentType(file));
  if (obj.customMetadata?.sha256) headers.set("x-checksum-sha256", obj.customMetadata.sha256);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  let status = 200;
  if (obj.range && c.req.header("range")) {
    const range = obj.range as { offset?: number; length?: number; suffix?: number };
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix ?? range.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  onDownload();
  return new Response(c.req.method === "HEAD" ? null : obj.body, { status, headers });
}

/** Redirect to the newest compatible package, given ?target= (and ?tier=) or X-Gizlet-Target. */
dl.get("/github.com/:owner/:repo", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  if (!r) return c.text("Not a GitHub repository", 400);
  const target = c.req.query("target") ?? c.req.header("x-gizlet-target");
  const tier = (c.req.query("tier") ?? c.req.header("x-gizlet-tier") ?? "full") as Tier;
  if (!target) return c.redirect(`${c.env.SITE_ORIGIN}/${r.key}`, 302);
  if (!TARGET.test(target) || (tier !== "lite" && tier !== "full")) return c.text("target or tier is invalid", 400);
  const g = await ensureGizlet(c.env, r, c.executionCtx);
  if (!g) return c.text(`${r.key} has no Gizlet release`, 404);
  if (g.visibility === "blocked") return c.text(`${r.key} is blocked`, 403);
  const pkg = await pickInstall(c.env, g.repo, target, tier);
  if (!pkg) return c.text(`${g.name} has no package for ${target} (${tier})`, 404);
  return c.redirect(dlUrl(c.env, g.repo, pkg.tag, pkg.file), 302);
});

dl.on(["GET", "HEAD"], "/github.com/:owner/:repo/:tag/:file", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  const tag = c.req.param("tag");
  const file = c.req.param("file");
  if (!r || !TAG.test(tag) || !isAssetName(file)) return c.text("Not found", 404);
  const [g, rel] = await Promise.all([
    c.env.DB.prepare("SELECT owner, name_repo, visibility FROM gizlets WHERE repo = ?").bind(r.key).first<{ owner: string; name_repo: string; visibility: string }>(),
    c.env.DB.prepare("SELECT status FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<Pick<ReleaseRow, "status">>(),
  ]);
  if (!g || !rel) return c.text("Not found", 404);
  if (g.visibility === "blocked") return c.text(`${r.key} is blocked`, 403);
  const isPackage = file.endsWith(".gzl");
  // Packages are served only once their release has passed its checks.
  if (isPackage && rel.status !== "ready") return c.text(rel.status === "failed" ? `${r.key} ${tag} failed its checks` : `${r.key} ${tag} is still being checked`, rel.status === "failed" ? 410 : 409);
  const countDownload = () => {
    if (isPackage && c.req.method === "GET" && !c.req.header("range")) {
      c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gizlets SET downloads = downloads + 1 WHERE repo = ?").bind(r.key).run());
    }
  };
  const res = await fromR2(c, r2Key(r.key, tag, file), file, countDownload);
  if (res) return res;
  // Not mirrored (an older release): hand off to GitHub.
  countDownload();
  return c.redirect(assetUrl(c.env, g.owner, g.name_repo, tag, file), 302);
});

dl.notFound((c) => c.text("Not found", 404));

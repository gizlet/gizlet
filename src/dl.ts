/** dl.gizlet.io: package and art downloads, from R2 or else GitHub. */
import { Hono, type Context } from "hono";
import { packageUrl, pickInstall, type ReleaseRow } from "./db";
import type { Env } from "./env";
import { assetUrl, rawUrl } from "./github";
import { artKey, contentType, indexedFiles } from "./mirror";
import { ensureGizlet } from "./registry";
import { repoRef } from "./repo";
import { isAssetName, isRepoPath, TARGET, type GizletToml, type Tier } from "./schema";

type App = { Bindings: Env };
export const dl = new Hono<App>();

const TAG = /^[A-Za-z0-9._+-]{1,100}$/;

dl.get("/", (c) => c.redirect(c.env.SITE_ORIGIN, 302));

/** Serve an R2 object with Range, conditional and immutable caching headers; null when it is not in R2. */
async function fromR2(c: Context<App>, key: string, file: string, cacheControl: string, sha256: string | null, onDownload: () => void): Promise<Response | null> {
  const obj = await c.env.BUCKET.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) return null;
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", cacheControl);
  headers.set("access-control-allow-origin", "*");
  if (!headers.has("content-type")) headers.set("content-type", contentType(file));
  if (sha256) headers.set("x-checksum-sha256", sha256);
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
  return c.redirect(packageUrl(c.env, pkg), 302);
});

/** A package (a release asset name) or store art (a repository path) of a release. */
dl.on(["GET", "HEAD"], "/github.com/:owner/:repo/:tag/:file{.+}", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  const tag = c.req.param("tag");
  let file: string;
  try {
    file = c.req.param("file").split("/").map(decodeURIComponent).join("/");
  } catch {
    return c.text("Not found", 404);
  }
  if (!r || !TAG.test(tag) || !isRepoPath(file)) return c.text("Not found", 404);
  // One statement, so the status, the index and the package row all belong to one revision.
  const [g, rel] = await Promise.all([
    c.env.DB.prepare("SELECT owner, name_repo, visibility FROM gizlets WHERE repo = ?").bind(r.key).first<{ owner: string; name_repo: string; visibility: string }>(),
    c.env.DB.prepare(
      `SELECT r.status, r.spec_json, p.sha256, p.object FROM releases r
         LEFT JOIN packages p ON p.repo = r.repo AND p.tag = r.tag AND p.revision = r.revision AND p.file = ?
        WHERE r.repo = ? AND r.tag = ?`,
    )
      .bind(file, r.key, tag)
      .first<Pick<ReleaseRow, "status" | "spec_json"> & { sha256: string | null; object: string | null }>(),
  ]);
  if (!g || !rel) return c.text("Not found", 404);
  if (g.visibility === "blocked") return c.text(`${r.key} is blocked`, 403);
  // Nothing of a failed release is served. Of the others, only files gizlet.toml names: its
  // packages once checked, and its art (images and about pages: see parseSpec).
  if (rel.status === "failed") return c.text(`${r.key} ${tag} failed its checks`, 410);
  const files = indexedFiles(JSON.parse(rel.spec_json) as GizletToml);
  let key: string;
  let cacheControl: string;
  if (files.packages.has(file) && isAssetName(file)) {
    // Packages are served only once their release has passed its checks.
    if (rel.status !== "ready") return c.text(`${r.key} ${tag} is still being checked`, 409);
    if (!rel.sha256 || !rel.object) return c.text("Not found", 404);
    const pinned = c.req.query("sha256");
    // A URL for bytes this tag no longer has: the client should ask the API again.
    if (pinned !== undefined && pinned !== rel.sha256) return c.text(`${file} has changed; its sha256 is now ${rel.sha256}`, 404);
    key = rel.object;
    cacheControl = pinned ? "public, max-age=31536000, immutable" : "public, max-age=300";
  } else if (files.art.has(file)) {
    key = artKey(r.key, tag, file);
    cacheControl = "public, max-age=3600";
  } else {
    return c.text("Not found", 404);
  }
  const isPackage = files.packages.has(file) && isAssetName(file);
  const countDownload = () => {
    if (isPackage && c.req.method === "GET" && !c.req.header("range")) {
      c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gizlets SET downloads = downloads + 1 WHERE repo = ?").bind(r.key).run());
    }
  };
  const res = await fromR2(c, key, file, cacheControl, isPackage ? rel.sha256 : null, countDownload);
  if (res) return res;
  // Not mirrored (an older ready release, pruned from R2): hand off to GitHub. The client
  // checks the package against the sha256 the API gave it.
  countDownload();
  return c.redirect(isPackage ? assetUrl(c.env, g.owner, g.name_repo, tag, file) : rawUrl(c.env, g.owner, g.name_repo, tag, file), 302);
});

dl.notFound((c) => c.text("Not found", 404));

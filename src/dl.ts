/** dl.gizlet.io: package and art downloads, from R2 or else GitHub. */
import { Hono, type Context } from "hono";
import { packageUrl, pickInstall, type ReleaseRow } from "./db";
import { deviceArt, deviceArtKey, storeDeviceArt } from "./device-art";
import type { Env } from "./env";
import { assetUrl, rawUrl, reader } from "./github";
import { artKey, contentType, indexedFiles } from "./mirror";
import { latestOsTag, OS_FILE, OS_TAG } from "./os-release";
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

dl.on(["GET", "HEAD"], "/releases/latest/:file", async (c) => {
  const file = c.req.param("file");
  if (file !== "flash.sh" && file !== "flash.ps1" && file !== "manifest.json") return c.text("Not found", 404);
  const tag = await latestOsTag(c.env.BUCKET);
  if (!tag) return c.text("Not found", 404);
  c.header("cache-control", "public, max-age=60");
  return c.redirect(`${c.env.DL_ORIGIN}/releases/${tag}/${file}`, 302);
});

dl.on(["GET", "HEAD"], "/releases/:tag/:file{.+}", async (c) => {
  const tag = c.req.param("tag");
  const file = c.req.param("file");
  if (!OS_TAG.test(tag) || !OS_FILE.test(file)) return c.text("Not found", 404);
  const prefix = `releases/${tag}/`;
  if (file !== "manifest.json" && !(await c.env.BUCKET.head(`${prefix}manifest.json`))) {
    return c.text("Not found", 404);
  }
  const response = await fromR2(c, prefix + file, file, "public, max-age=31536000, immutable", null, () => {});
  return response ?? c.text("Not found", 404);
});

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

/**
 * A release's art as handhelds draw it (src/device-art.ts). Releases mirrored before device art
 * existed get theirs made from the mirrored art on first request.
 */
dl.on(["GET", "HEAD"], "/github.com/:owner/:repo/:tag/~device/:name", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  const tag = c.req.param("tag");
  const name = c.req.param("name");
  if (!r || !TAG.test(tag)) return c.text("Not found", 404);
  const [g, rel] = await Promise.all([
    c.env.DB.prepare("SELECT visibility FROM gizlets WHERE repo = ?").bind(r.key).first<{ visibility: string }>(),
    c.env.DB.prepare("SELECT status, spec_json FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<Pick<ReleaseRow, "status" | "spec_json">>(),
  ]);
  if (!g || !rel) return c.text("Not found", 404);
  if (g.visibility === "blocked") return c.text(`${r.key} is blocked`, 403);
  if (rel.status === "failed") return c.text(`${r.key} ${tag} failed its checks`, 410);
  const art = deviceArt(JSON.parse(rel.spec_json) as GizletToml).get(name);
  if (!art) return c.text("Not found", 404);
  const key = deviceArtKey(r.key, tag, name);
  const serve = () => fromR2(c, key, name, "public, max-age=3600", null, () => {});
  const found = await serve();
  if (found) return found;
  const source = await c.env.BUCKET.get(artKey(r.key, tag, art.source));
  if (!source || !(await storeDeviceArt(c.env, r.key, tag, name, art, source.body))) return c.text("Not found", 404);
  return (await serve()) ?? c.text("Not found", 404);
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
    c.env.DB.prepare("SELECT owner, name_repo, visibility, private FROM gizlets WHERE repo = ?")
      .bind(r.key)
      .first<{ owner: string; name_repo: string; visibility: string; private: number }>(),
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
  const isPackage = files.packages.has(file) && isAssetName(file);
  let key: string;
  let cacheControl: string;
  if (isPackage) {
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
  const countDownload = () => {
    if (isPackage && c.req.method === "GET" && !c.req.header("range")) {
      c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gizlets SET downloads = downloads + 1 WHERE repo = ?").bind(r.key).run());
    }
  };
  const res = await fromR2(c, key, file, cacheControl, isPackage ? rel.sha256 : null, countDownload);
  if (res) return res;
  // Not mirrored (an older ready release, pruned from R2): hand off to GitHub. The client
  // checks the package against the sha256 the API gave it. A private repository's assets have
  // no public URL, so the GitHub App asks for a short-lived one, which is never cached; when
  // GitHub hands over the bytes instead, they are passed on.
  const ref = { owner: g.owner, name: g.name_repo, key: r.key };
  if (!isPackage) {
    // Art of a pruned release: the repository file at the tag, never cached for a private one.
    if (!g.private) return c.redirect(rawUrl(c.env, g.owner, g.name_repo, tag, file), 302);
    const got = await (await reader(c.env, ref)).file(tag, file);
    if (!got.ok) {
      await got.body?.cancel();
      return c.text("Not found", 404);
    }
    const headers = new Headers({ "content-type": contentType(file), "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" });
    if (c.req.method === "HEAD") {
      await got.body?.cancel();
      return new Response(null, { headers });
    }
    return new Response(got.body, { headers });
  }
  if (g.private) {
    const got = await (await reader(c.env, ref)).download(tag, file, c.req.header("range"));
    if (!got) return c.text("Not found", 404);
    countDownload();
    if ("url" in got) {
      c.header("cache-control", "no-store");
      return c.redirect(got.url, 302);
    }
    // Passed on as GitHub answered, partial content and range headers included, so resumes work.
    const headers = new Headers({ "content-type": contentType(file), "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" });
    for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = got.response.headers.get(h);
      if (v) headers.set(h, v);
    }
    const status = got.response.status;
    if (c.req.method === "HEAD") {
      await got.response.body?.cancel();
      return new Response(null, { status, headers });
    }
    return new Response(got.response.body, { status, headers });
  }
  countDownload();
  return c.redirect(assetUrl(c.env, g.owner, g.name_repo, tag, file), 302);
});

dl.notFound((c) => c.text("Not found", 404));

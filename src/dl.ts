/** Package, art and OS downloads from R2, with GitHub fallback for store files. */
import { Hono, type Context } from "hono";
import { packageUrl, type ReleaseRow } from "./db";
import { deviceArt, deviceArtKey, storeDeviceArt } from "./device-art";
import type { Env } from "./env";
import { assetUrl, rawUrl, readCapped, reader } from "./github";
import { artKey, contentType, indexedFiles, MAX_ART_BYTES } from "./mirror";
import { OS_FILE, OS_TAG } from "./os-release";
import { latestMacosRelease, MACOS_FILE, MACOS_LATEST, macosKey } from "./macos-release";
import { ensureGizlet, pickInstallRecovering } from "./registry";
import { repoRef } from "./repo";
import { isAssetName, isRepoPath, TARGET, type GizletToml, type Tier } from "./schema";

type App = { Bindings: Env };
export const dl = new Hono<App>();

const TAG = /^[A-Za-z0-9._+-]{1,100}$/;
const EDGE_CACHE_MAX_BYTES = 512_000_000;
const IMMUTABLE = "public, max-age=31536000, immutable";

/** Serve an R2 object with Range, conditional and immutable caching headers; null when it is not in R2. */
async function fromR2(c: Context<App>, key: string, file: string, cacheControl: string, sha256: string | null, onDownload: () => void, edgeCache = false): Promise<Response | null> {
  const request = c.req.raw;
  const cacheKey = edgeCache ? new Request(`${c.env.SITE_ORIGIN}/assets/_cache/v1/${key.split("/").map(encodeURIComponent).join("/")}`) : null;
  if (cacheKey && !request.headers.has("if-range") && !request.headers.has("if-match") && !request.headers.has("if-unmodified-since")) {
    const headers = new Headers();
    for (const name of ["range", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const cached = await caches.default.match(new Request(cacheKey, { headers })).catch(() => undefined);
    if (cached) {
      const response = new Response(request.method === "HEAD" ? null : cached.body, cached);
      if (request.method === "HEAD") await cached.body?.cancel();
      response.headers.set("cache-control", cacheControl);
      response.headers.set("x-gizlet-edge-cache", "HIT");
      if (response.status === 200 || response.status === 206) onDownload();
      return response;
    }
  }
  const obj = await c.env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return null;
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'");
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
  const response = new Response(request.method === "HEAD" ? null : obj.body, { status, headers });
  if (request.method === "HEAD") await obj.body.cancel();
  if (cacheKey && request.method === "GET" && status === 200 && obj.size <= EDGE_CACHE_MAX_BYTES && !request.headers.has("range")) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set("cache-control", IMMUTABLE);
    c.executionCtx.waitUntil(caches.default.put(cacheKey, stored).catch((error) => console.warn("download cache write failed", error)));
  }
  if (cacheKey) response.headers.set("x-gizlet-edge-cache", "MISS");
  return response;
}

dl.on(["GET", "HEAD"], "/releases/:tag/:file{.+}", async (c) => {
  const tag = c.req.param("tag");
  const file = c.req.param("file");
  if (!OS_TAG.test(tag) || !OS_FILE.test(file)) return c.text("Not found", 404);
  const prefix = `releases/${tag}/`;
  if (file !== "manifest.json" && !(await c.env.BUCKET.head(`${prefix}manifest.json`))) {
    return c.text("Not found", 404);
  }
  const response = await fromR2(c, prefix + file, file, IMMUTABLE, null, () => {}, true);
  return response ?? c.text("Not found", 404);
});

/** The Launcher's update manifest: revalidated on every request, so a new release shows at once. */
dl.on(["GET", "HEAD"], "/macos/latest.json", async (c) => {
  const response = await fromR2(c, MACOS_LATEST, "latest.json", "no-cache", null, () => {});
  return response ?? c.text("Not found", 404);
});

/** The newest disk image, for download buttons. */
dl.on(["GET", "HEAD"], "/macos/download", async (c) => {
  const latest = await latestMacosRelease(c.env.BUCKET);
  if (!latest) return c.text("Not found", 404);
  c.header("cache-control", "no-cache");
  return c.redirect(`${c.env.SITE_ORIGIN}/assets/${macosKey(latest.tag, latest.dmg)}`, 302);
});

/** A version's files, which never change; served once its manifest, uploaded last, is there. */
dl.on(["GET", "HEAD"], "/macos/releases/:tag/:file", async (c) => {
  const tag = c.req.param("tag");
  const file = c.req.param("file");
  if (!OS_TAG.test(tag) || !MACOS_FILE.test(file)) return c.text("Not found", 404);
  if (file !== "manifest.json" && !(await c.env.BUCKET.head(macosKey(tag, "manifest.json")))) {
    return c.text("Not found", 404);
  }
  const response = await fromR2(c, macosKey(tag, file), file, IMMUTABLE, null, () => {}, true);
  return response ?? c.text("Not found", 404);
});

/**
 * Gizlet Launcher for Windows, published by gizlet/windows's Release workflow under `windows/` in
 * R2. `update.json` is the signed manifest running Launchers poll, revalidated on every request;
 * installers are immutable, and served only when their name matches their release's tag.
 */
const WINDOWS_INSTALLER = /^GizletSetup-((?:0|[1-9][0-9]{0,8})(?:\.(?:0|[1-9][0-9]{0,8})){2})-(x64|arm64)\.exe$/;

dl.on(["GET", "HEAD"], "/windows/update.json", async (c) => {
  const response = await fromR2(c, "windows/update.json", "update.json", "no-cache", null, () => {});
  return response ?? c.text("Not found", 404);
});

dl.on(["GET", "HEAD"], "/windows/releases/:tag/:file", async (c) => {
  const tag = c.req.param("tag");
  const file = c.req.param("file");
  const match = WINDOWS_INSTALLER.exec(file);
  if (!OS_TAG.test(tag) || !match || `v${match[1]}` !== tag) return c.text("Not found", 404);
  const response = await fromR2(c, `windows/releases/${tag}/${file}`, file, IMMUTABLE, null, () => {}, true);
  return response ?? c.text("Not found", 404);
});

/** The newest installer for an architecture, as the published update manifest names it. */
dl.get("/windows/latest/:arch", async (c) => {
  const arch = c.req.param("arch");
  if (arch !== "x64" && arch !== "arm64") return c.text("Not found", 404);
  const object = await c.env.BUCKET.get("windows/update.json");
  const envelope = await object?.json<{ manifest?: unknown }>().catch(() => null);
  let manifest: { tag?: unknown; installers?: Record<string, { path?: unknown }> } | null = null;
  try {
    manifest = typeof envelope?.manifest === "string" ? JSON.parse(envelope.manifest) : null;
  } catch {
    manifest = null;
  }
  const tag = manifest?.tag;
  const path = manifest?.installers?.[arch]?.path;
  const match = typeof path === "string" ? WINDOWS_INSTALLER.exec(path) : null;
  if (typeof tag !== "string" || !OS_TAG.test(tag) || !match || `v${match[1]}` !== tag || match[2] !== arch) return c.text("Not found", 404);
  c.header("cache-control", "public, max-age=60");
  return c.redirect(`${c.env.SITE_ORIGIN}/assets/windows/releases/${tag}/${path}`, 302);
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
  const pkg = await pickInstallRecovering(c.env, g, target, tier);
  if (!pkg) {
    const pending = await c.env.DB.prepare("SELECT 1 FROM releases WHERE repo = ? AND status IN ('pending', 'mirroring', 'checking')").bind(g.repo).first();
    if (pending) return c.text(`${g.name} is still being checked; try again in a minute`, 409);
    return c.text(`${g.name} has no package for ${target} (${tier})`, 404);
  }
  return c.redirect(packageUrl(c.env, pkg), 302);
});

/**
 * A release's art as handhelds draw it (src/device-art.ts), for the release's current revision.
 * Releases mirrored before device art existed, and ones pruned from R2, get theirs made on first
 * request from the art, mirrored or else read from the repository at the tag.
 */
dl.on(["GET", "HEAD"], "/github.com/:owner/:repo/:tag/~device/:name", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  const tag = c.req.param("tag");
  const name = c.req.param("name");
  if (!r || !TAG.test(tag)) return c.text("Not found", 404);
  const [g, rel] = await Promise.all([
    c.env.DB.prepare("SELECT owner, name_repo, visibility FROM gizlets WHERE repo = ?").bind(r.key).first<{ owner: string; name_repo: string; visibility: string }>(),
    c.env.DB.prepare("SELECT status, revision, spec_json FROM releases WHERE repo = ? AND tag = ?").bind(r.key, tag).first<Pick<ReleaseRow, "status" | "revision" | "spec_json">>(),
  ]);
  if (!g || !rel) return c.text("Not found", 404);
  if (g.visibility === "blocked") return c.text(`${r.key} is blocked`, 403);
  if (rel.status === "failed") return c.text(`${r.key} ${tag} failed its checks`, 410);
  const art = deviceArt(JSON.parse(rel.spec_json) as GizletToml).get(name);
  if (!art) return c.text("Not found", 404);
  const key = deviceArtKey(r.key, tag, rel.revision, name);
  const serve = () => fromR2(c, key, name, "public, max-age=3600", null, () => {});
  const found = await serve();
  if (found) return found;
  // The mirrored copy only if this revision wrote it: a re-index that could not copy the art
  // leaves the previous revision's in place. Otherwise the file in the repository at the tag, and
  // failing that a copy mirrored before copies were labelled with their revision.
  const mirrored = await c.env.BUCKET.get(artKey(r.key, tag, art.source));
  const labelled = mirrored?.customMetadata?.revision;
  let source: Uint8Array | ReadableStream<Uint8Array> | null = null;
  if (labelled === String(rel.revision)) source = mirrored!.body;
  else await mirrored?.body.cancel();
  if (!source) {
    const got = await (await reader(c.env, { owner: g.owner, name: g.name_repo, key: r.key })).file(tag, art.source);
    if (got.ok) source = await readCapped(got, MAX_ART_BYTES).catch(() => null);
    else await got.body?.cancel();
  }
  if (!source && mirrored && labelled === undefined) source = (await c.env.BUCKET.get(artKey(r.key, tag, art.source)))?.body ?? null;
  if (!source || !(await storeDeviceArt(c.env, r.key, tag, rel.revision, name, art, source))) return c.text("Not found", 404);
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
  let edgeCache = false;
  if (isPackage) {
    // Packages are served only once their release has passed its checks.
    if (rel.status !== "ready") return c.text(`${r.key} ${tag} is still being checked`, 409);
    if (!rel.sha256 || !rel.object) return c.text("Not found", 404);
    const pinned = c.req.query("sha256");
    // A URL for bytes this tag no longer has: the client should ask the API again.
    if (pinned !== undefined && pinned !== rel.sha256) return c.text(`${file} has changed; its sha256 is now ${rel.sha256}`, 404);
    key = rel.object;
    cacheControl = "public, max-age=0, must-revalidate";
    edgeCache = pinned !== undefined && !g.private;
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
  const res = await fromR2(c, key, file, cacheControl, isPackage ? rel.sha256 : null, countDownload, edgeCache);
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

/**
 * Queue consumer: copy a release into R2, verify checksums, run the static checks.
 *
 * Each indexing of a release bumps its `revision`, and every job carries the revision it was
 * queued for. A job for an older revision does nothing, and every status change is conditional
 * on the revision, so a job that was already running when the tag was republished cannot mark
 * the new gizlet.toml ready. Packages are stored under their revision, so jobs for different
 * revisions never overwrite each other's files. A package's size and sha256 are learnt here, as it
 * streams from GitHub into R2.
 */
import { checkPackage } from "./check";
import type { PackageRow, ReleaseRow } from "./db";
import type { Env, MirrorJob } from "./env";
import { assetUrl, ghFetch, rawUrl, readCapped, UpstreamError } from "./github";
import { refreshLatest } from "./registry";
import { compareVersions, MAX_PACKAGE_BYTES, type GizletToml } from "./schema";

const MAX_ART_BYTES = 10 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
/** A release this long in pending, mirroring or checking has lost its job; queue it again. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

/** R2 key of store art (icon, cover, pattern, screenshots, about pages): its repository path. */
export function artKey(repo: string, tag: string, path: string): string {
  return `${repo}/${tag}/repo/${path}`;
}

/** R2 key of a package: under the release revision, so each indexed revision has its own object. */
export function packageKey(repo: string, tag: string, revision: number, file: string): string {
  return `${repo}/${tag}/packages/r${revision}/${file}`;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gzl: "application/vnd.gizlet.package+zip",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
};
export function contentType(file: string): string {
  return CONTENT_TYPES[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}

/** What gizlet.toml names: its packages (release assets) and store art (repository paths). Nothing else is served. */
export function indexedFiles(spec: GizletToml): { packages: Set<string>; art: Set<string> } {
  const packages = new Set(spec.packages.map((p) => p.file));
  const art = [spec.icon, spec.cover, spec.pattern, ...spec.screenshots, ...Object.values(spec.about)].filter((f): f is string => !!f);
  return { packages, art: new Set(art) };
}

/** A release that can never become ready as published. */
class Rejected extends Error {}
/** The release was indexed again while this job ran. */
class Superseded extends Error {}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Stream a GitHub release asset into R2 under `key`, learning its size and sha256 on the way. */
async function copyToR2(env: Env, url: string, key: string, file: string): Promise<{ size: number; sha256: string }> {
  const res = await ghFetch(url);
  if (res.status === 404) {
    await res.body?.cancel();
    throw new Rejected(`${file} is missing from the GitHub release`);
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for ${file}`);
  }
  const size = Number(res.headers.get("content-length") ?? NaN);
  if (!Number.isSafeInteger(size) || size <= 0) {
    await res.body.cancel();
    throw new UpstreamError(`GitHub sent ${file} without its length`);
  }
  if (size > MAX_PACKAGE_BYTES) {
    await res.body.cancel();
    throw new Rejected(`${file} is larger than ${MAX_PACKAGE_BYTES} bytes`);
  }
  // Hash each chunk on its way to R2; awaiting the digest's writer keeps the two in step.
  const digest = new crypto.DigestStream("SHA-256");
  const hasher = digest.getWriter();
  const hashing = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, out) {
      await hasher.write(chunk);
      out.enqueue(chunk);
    },
    async flush() {
      await hasher.close();
    },
  });
  const fixed = new FixedLengthStream(size);
  const piping = res.body.pipeThrough(hashing).pipeTo(fixed.writable).catch((e: unknown) => {
    throw new UpstreamError(`${file} did not arrive whole: ${String(e)}`);
  });
  await Promise.all([
    env.BUCKET.put(key, fixed.readable, {
      httpMetadata: { contentType: contentType(file), contentDisposition: `attachment; filename="${file}"` },
    }),
    piping,
  ]);
  return { size, sha256: hex(await digest.digest) };
}

export async function deletePrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.BUCKET.list({ prefix, cursor });
    if (list.objects.length) await env.BUCKET.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

/** Set the status of one revision of a release; false when the release has moved on. */
async function setStatus(env: Env, job: MirrorJob, status: ReleaseRow["status"], error: string | null, warnings: string[] = [], mirrored = false): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE releases SET status = ?, error = ?, warnings = ?, mirrored = ?, updated_at = ? WHERE repo = ? AND tag = ? AND revision = ?",
  )
    .bind(status, error, JSON.stringify(warnings), mirrored ? 1 : 0, Date.now(), job.repo, job.tag, job.revision)
    .run();
  return res.meta.changes > 0;
}

export async function mirrorRelease(env: Env, job: MirrorJob, attempt: number): Promise<void> {
  const rel = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(job.repo, job.tag).first<ReleaseRow>();
  if (!rel || rel.revision !== job.revision) return;
  // Already decided: a retry (the follow-up work threw last time) redoes only that work.
  if (rel.status === "ready" || rel.status === "failed") return settle(env, job, rel.status);
  const g = await env.DB.prepare("SELECT owner, name_repo FROM gizlets WHERE repo = ?").bind(job.repo).first<{ owner: string; name_repo: string }>();
  if (!g) return;
  const spec = JSON.parse(rel.spec_json) as GizletToml;
  const { results: pkgs } = await env.DB.prepare("SELECT * FROM packages WHERE repo = ? AND tag = ? AND revision = ?").bind(job.repo, job.tag, job.revision).all<PackageRow>();
  const warnings: string[] = [];
  try {
    if (!(await setStatus(env, job, "mirroring", null))) throw new Superseded();
    for (const p of pkgs) {
      const key = packageKey(job.repo, job.tag, job.revision, p.file);
      // Mirrored by an earlier attempt of this job.
      if (p.sha256 && p.size && (await env.BUCKET.head(key))?.size === p.size) continue;
      const got = await copyToR2(env, assetUrl(env, g.owner, g.name_repo, job.tag, p.file), key, p.file);
      Object.assign(p, got);
      await env.DB.prepare("UPDATE packages SET size = ?, sha256 = ? WHERE repo = ? AND tag = ? AND file = ? AND revision = ?")
        .bind(got.size, got.sha256, job.repo, job.tag, p.file, job.revision)
        .run();
    }
    for (const file of indexedFiles(spec).art) {
      const res = await ghFetch(rawUrl(env, g.owner, g.name_repo, job.tag, file));
      if (!res.ok) {
        await res.body?.cancel();
        warnings.push(`${file} is missing from the repository at ${job.tag}`);
        continue;
      }
      const bytes = await readCapped(res, MAX_ART_BYTES).catch(() => null);
      if (bytes) await env.BUCKET.put(artKey(job.repo, job.tag, file), bytes, { httpMetadata: { contentType: contentType(file) } });
      else warnings.push(`${file} is larger than 10 MiB`);
    }

    if (!(await setStatus(env, job, "checking", null))) throw new Superseded();
    const errors: string[] = [];
    for (const p of pkgs) {
      const found = await checkPackage(env, packageKey(job.repo, job.tag, job.revision, p.file), p.file, p.size!, {
        id: spec.id,
        name: spec.name,
        version: spec.version,
        runtime: spec.runtime,
        target: p.target,
        tier: p.tier,
        entry: p.entry,
      });
      errors.push(...found.errors);
      warnings.push(...found.warnings);
    }
    if (errors.length) throw new Rejected(errors.slice(0, 10).join("; "));
  } catch (e) {
    if (e instanceof Superseded) return;
    if (e instanceof Rejected || attempt >= MAX_ATTEMPTS) {
      if (!(await setStatus(env, job, "failed", e instanceof Error ? e.message : String(e)))) return;
      return settle(env, job, "failed");
    }
    await setStatus(env, job, "pending", null);
    throw e;
  }
  if (!spec.icon) warnings.push("gizlet.toml names no icon");
  if (!spec.description) warnings.push("gizlet.toml has no description");
  if (!(await setStatus(env, job, "ready", null, warnings, true))) return;
  await settle(env, job, "ready");
}

/**
 * The work that follows a release's verdict: point the gizlet at its newest release and update
 * its visibility, then prune old mirrors, or drop a failed release's packages from R2. Every
 * step is idempotent; if one throws, the queue retries the job, which comes back here.
 */
async function settle(env: Env, job: MirrorJob, status: "ready" | "failed"): Promise<void> {
  if (status === "failed") {
    // Nothing of a failed release is served, so its packages need not stay in R2.
    const { results } = await env.DB.prepare("SELECT file FROM packages WHERE repo = ? AND tag = ? AND revision = ?")
      .bind(job.repo, job.tag, job.revision)
      .all<Pick<PackageRow, "file">>();
    await Promise.all(results.map((p) => env.BUCKET.delete(packageKey(job.repo, job.tag, job.revision, p.file))));
  }
  await refreshLatest(env, job.repo);
  if (status === "ready") await pruneMirrors(env, job.repo);
}

/**
 * Queue a job for a release's current revision. A job that is lost (the send failed after
 * the release was recorded, or the consumer died) is recovered by `requeueStuck`.
 */
export async function queueMirror(env: Env, repo: string, tag: string, revision: number): Promise<void> {
  await env.MIRROR.send({ repo, tag, revision });
}

/** Cron: queue again releases that have sat in pending, mirroring or checking too long. */
export async function requeueStuck(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT repo, tag, revision FROM releases WHERE status IN ('pending', 'mirroring', 'checking') AND updated_at < ? ORDER BY updated_at LIMIT 50",
  )
    .bind(Date.now() - STUCK_AFTER_MS)
    .all<{ repo: string; tag: string; revision: number }>();
  for (const r of results) {
    await env.DB.prepare("UPDATE releases SET status = 'pending', updated_at = ? WHERE repo = ? AND tag = ? AND revision = ?").bind(Date.now(), r.repo, r.tag, r.revision).run();
    await queueMirror(env, r.repo, r.tag, r.revision);
  }
}

/** Keep only the newest KEEP_MIRRORED_RELEASES releases in R2; older downloads redirect to GitHub. */
export async function pruneMirrors(env: Env, repo: string): Promise<void> {
  const keep = Math.max(1, Number.parseInt(env.KEEP_MIRRORED_RELEASES, 10) || 2);
  const { results } = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND status = 'ready' AND mirrored = 1").bind(repo).all<ReleaseRow>();
  for (const r of results.sort((a, b) => compareVersions(b.version, a.version)).slice(keep)) {
    await deletePrefix(env, `${repo}/${r.tag}/`);
    await env.DB.prepare("UPDATE releases SET mirrored = 0 WHERE repo = ? AND tag = ? AND revision = ?").bind(repo, r.tag, r.revision).run();
  }
}

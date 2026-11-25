/** Queue consumer: copy a release into R2, verify checksums, run the static checks. */
import { checkPackage } from "./check";
import type { PackageRow, ReleaseRow } from "./db";
import type { Env, MirrorJob } from "./env";
import { assetUrl, ghFetch, readCapped, UpstreamError } from "./github";
import { refreshLatest } from "./registry";
import { compareVersions, type ReleaseIndex } from "./schema";

const MAX_ART_BYTES = 10 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_ATTEMPTS = 5;

export function r2Key(repo: string, tag: string, file: string): string {
  return `${repo}/${tag}/${file}`;
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

/** A release that can never become ready as published. */
class Rejected extends Error {}

/** Stream a GitHub release asset into R2 under `key`; R2 rejects it unless it matches `sha256`. */
async function copyToR2(env: Env, url: string, key: string, file: string, sha256: string, size: number): Promise<void> {
  const res = await ghFetch(url);
  if (res.status === 404) {
    await res.body?.cancel();
    throw new Rejected(`${file} is missing from the GitHub release`);
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for ${file}`);
  }
  if (size > MAX_DOWNLOAD_BYTES) {
    await res.body.cancel();
    throw new Rejected(`${file} is larger than ${MAX_DOWNLOAD_BYTES} bytes`);
  }
  const fixed = new FixedLengthStream(size);
  const piping = res.body.pipeTo(fixed.writable).catch((e: unknown) => {
    throw new Rejected(`${file} is not ${size} bytes: ${String(e)}`);
  });
  try {
    await Promise.all([
      env.BUCKET.put(key, fixed.readable, {
        sha256,
        httpMetadata: { contentType: contentType(file), contentDisposition: `attachment; filename="${file}"` },
        customMetadata: { sha256 },
      }),
      piping,
    ]);
  } catch (e) {
    if (e instanceof Rejected) throw e;
    if (/checksum|sha-?256|digest|length/i.test(String(e))) throw new Rejected(`${file} does not match its sha256`);
    throw e;
  }
}

export async function deletePrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.BUCKET.list({ prefix, cursor });
    if (list.objects.length) await env.BUCKET.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

async function setStatus(env: Env, rel: ReleaseRow, status: ReleaseRow["status"], error: string | null, warnings: string[] = []) {
  await env.DB.prepare("UPDATE releases SET status = ?, error = ?, warnings = ?, updated_at = ? WHERE repo = ? AND tag = ?")
    .bind(status, error, JSON.stringify(warnings), Date.now(), rel.repo, rel.tag)
    .run();
}

export async function mirrorRelease(env: Env, job: MirrorJob, attempt: number): Promise<void> {
  const rel = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(job.repo, job.tag).first<ReleaseRow>();
  if (!rel || rel.status === "ready" || rel.status === "failed") return;
  const g = await env.DB.prepare("SELECT owner, name_repo FROM gizlets WHERE repo = ?").bind(job.repo).first<{ owner: string; name_repo: string }>();
  if (!g) return;
  const index = JSON.parse(rel.index_json) as ReleaseIndex;
  const { results: pkgs } = await env.DB.prepare("SELECT * FROM packages WHERE repo = ? AND tag = ?").bind(job.repo, job.tag).all<PackageRow>();
  const warnings: string[] = [];
  try {
    await setStatus(env, rel, "mirroring", null);
    for (const p of pkgs) {
      const key = r2Key(job.repo, job.tag, p.file);
      const head = await env.BUCKET.head(key);
      if (head?.customMetadata?.sha256 === p.sha256) continue;
      await copyToR2(env, assetUrl(env, g.owner, g.name_repo, job.tag, p.file), key, p.file, p.sha256, p.size);
    }
    for (const file of [index.icon, index.cover, ...index.screenshots, ...Object.values(index.about)].filter((f): f is string => !!f)) {
      const key = r2Key(job.repo, job.tag, file);
      if (await env.BUCKET.head(key)) continue;
      const res = await ghFetch(assetUrl(env, g.owner, g.name_repo, job.tag, file));
      if (!res.ok) {
        await res.body?.cancel();
        warnings.push(`${file} is missing from the GitHub release`);
        continue;
      }
      const bytes = await readCapped(res, MAX_ART_BYTES).catch(() => null);
      if (bytes) await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: contentType(file) } });
      else warnings.push(`${file} is larger than 10 MiB`);
    }

    await setStatus(env, rel, "checking", null);
    const errors: string[] = [];
    for (const p of pkgs) {
      const found = await checkPackage(env, r2Key(job.repo, job.tag, p.file), p.file, p.size, { id: index.id, version: index.version, target: p.target });
      errors.push(...found.errors);
      warnings.push(...found.warnings);
    }
    if (errors.length) throw new Rejected(errors.slice(0, 10).join("; "));
  } catch (e) {
    if (e instanceof Rejected || attempt >= MAX_ATTEMPTS) {
      // Nothing of a failed release is served, so its packages need not stay in R2.
      await Promise.all(pkgs.map((p) => env.BUCKET.delete(r2Key(job.repo, job.tag, p.file))));
      await setStatus(env, rel, "failed", e instanceof Error ? e.message : String(e));
      await refreshLatest(env, job.repo);
      return;
    }
    await setStatus(env, rel, "pending", null);
    throw e;
  }
  if (!index.icon) warnings.push("gizlet.json names no icon");
  if (!index.description) warnings.push("gizlet.json has no description");
  await env.DB.prepare("UPDATE releases SET status = 'ready', error = NULL, warnings = ?, mirrored = 1, updated_at = ? WHERE repo = ? AND tag = ?")
    .bind(JSON.stringify(warnings), Date.now(), job.repo, job.tag)
    .run();
  await refreshLatest(env, job.repo);
  await pruneMirrors(env, job.repo);
}

/** Keep only the newest KEEP_MIRRORED_RELEASES releases in R2; older downloads redirect to GitHub. */
export async function pruneMirrors(env: Env, repo: string): Promise<void> {
  const keep = Math.max(1, Number.parseInt(env.KEEP_MIRRORED_RELEASES, 10) || 2);
  const { results } = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND status = 'ready' AND mirrored = 1").bind(repo).all<ReleaseRow>();
  for (const r of results.sort((a, b) => compareVersions(b.version, a.version)).slice(keep)) {
    await deletePrefix(env, `${repo}/${r.tag}/`);
    await env.DB.prepare("UPDATE releases SET mirrored = 0 WHERE repo = ? AND tag = ?").bind(repo, r.tag).run();
  }
}

/** Indexing releases into the registry, and deciding what is listed. */
import { parse, type GizletRow, type ReleaseRow } from "./db";
import type { Env, Waiter } from "./env";
import { fetchGizletToml, latestTag, NotFound } from "./github";
import { queueMirror } from "./mirror";
import type { RepoRef } from "./repo";
import { compareVersions, IndexError, type GizletToml } from "./schema";

const MISS_TTL_MS = 10 * 60 * 1000;
export const REFRESH_AFTER_MS = 30 * 60 * 1000;

export interface IndexOptions {
  repositoryId?: number;
  /** Display casing of owner/name, e.g. from the OIDC `repository` claim. */
  display?: { owner: string; name: string };
  /**
   * Index the release again even when its gizlet.toml has not changed: a publish from CI, whose
   * packages may have been rebuilt, or a release that failed before.
   */
  force?: boolean;
}

/** Record a release from its gizlet.toml, point the gizlet at its newest release and queue mirroring. */
export async function indexRelease(env: Env, ref: RepoRef, tag: string, opts: IndexOptions = {}): Promise<ReleaseRow> {
  const spec = await fetchGizletToml(env, ref, tag);
  if (!/^v?\d/.test(tag)) throw new IndexError(`tag ${tag} must be v<version>`);
  if (tag.replace(/^v/, "") !== spec.version) throw new IndexError(`tag ${tag} does not match gizlet.toml version ${spec.version}`);
  const now = Date.now();
  const specJson = JSON.stringify(spec);
  const existing = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(ref.key, tag).first<ReleaseRow>();
  // Browsing re-indexes a release only when its gizlet.toml changed, and never re-checks a failed one.
  if (existing?.status === "failed" && existing.spec_json === specJson && !opts.force) return existing;
  const unchanged = existing && existing.spec_json === specJson && !opts.force;
  const owner = opts.display?.owner ?? ref.owner;
  const name = opts.display?.name ?? ref.name;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO gizlets (repo, owner, name_repo, repository_id, app_id, name, created_at, updated_at, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo) DO UPDATE SET checked_at = excluded.checked_at,
         repository_id = coalesce(excluded.repository_id, gizlets.repository_id),
         owner = CASE WHEN ?10 THEN excluded.owner ELSE gizlets.owner END,
         name_repo = CASE WHEN ?10 THEN excluded.name_repo ELSE gizlets.name_repo END`,
    ).bind(ref.key, owner, name, opts.repositoryId ?? null, spec.id, spec.name, now, now, now, opts.display ? 1 : 0),
    env.DB.prepare("DELETE FROM misses WHERE repo = ?").bind(ref.key),
  ];
  if (!unchanged) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO releases (repo, tag, version, status, error, warnings, spec_json, mirrored, published_at, updated_at)
         VALUES (?, ?, ?, 'pending', NULL, '[]', ?, 0, ?, ?)
         ON CONFLICT (repo, tag) DO UPDATE SET version = excluded.version, status = 'pending', error = NULL, warnings = '[]',
           spec_json = excluded.spec_json, mirrored = 0, updated_at = excluded.updated_at, revision = releases.revision + 1`,
      ).bind(ref.key, tag, spec.version, specJson, now, now),
      env.DB.prepare("DELETE FROM packages WHERE repo = ? AND tag = ?").bind(ref.key, tag),
      // Size and sha256 are filled in by the mirror job.
      ...spec.packages.map((p) =>
        env.DB.prepare(
          "INSERT INTO packages (repo, tag, file, target, tier, entry, revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT revision FROM releases WHERE repo = ?1 AND tag = ?2))",
        ).bind(ref.key, tag, p.file, p.target, p.tier, p.entry),
      ),
    );
  }
  await env.DB.batch(stmts);
  await refreshLatest(env, ref.key);
  const rel = (await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(ref.key, tag).first<ReleaseRow>())!;
  // A new revision needs a job; a lost one is queued again by the cron (requeueStuck).
  if (!unchanged) await queueMirror(env, ref.key, tag, rel.revision);
  return rel;
}

/**
 * Copy the newest release's metadata onto the gizlet: the newest ready release, or while none
 * is ready yet, the newest one still being mirrored or checked. Then update the visibility.
 */
export async function refreshLatest(env: Env, repo: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND status != 'failed'").bind(repo).all<ReleaseRow>();
  const byVersion = (a: ReleaseRow, b: ReleaseRow) => compareVersions(b.version, a.version) || b.published_at - a.published_at;
  const ready = results.filter((r) => r.status === "ready").sort(byVersion);
  const latest = ready[0] ?? results.sort(byVersion)[0];
  if (!latest) {
    await env.DB.prepare("UPDATE gizlets SET latest_tag = NULL, version = NULL WHERE repo = ?").bind(repo).run();
  } else {
    const idx = JSON.parse(latest.spec_json) as GizletToml;
    const targets = [...new Set(idx.packages.map((p) => p.target))].sort();
    const tiers = [...new Set(idx.packages.map((p) => p.tier))].sort();
    await env.DB.prepare(
      `UPDATE gizlets SET app_id = ?, name = ?, names = ?, description = ?, descriptions = ?, category = ?, tags = ?, color = ?, license = ?, links = ?,
         icon = ?, cover = ?, pattern = ?, screenshots = ?, about = ?, controls = ?, targets = ?, tiers = ?, version = ?,
         updated_at = CASE WHEN latest_tag IS ? THEN updated_at ELSE ? END, latest_tag = ?
       WHERE repo = ?`,
    )
      .bind(
        idx.id,
        idx.name,
        JSON.stringify(idx.names),
        idx.description,
        JSON.stringify(idx.descriptions),
        idx.category,
        JSON.stringify(idx.tags),
        idx.color,
        idx.license,
        JSON.stringify(idx.links ?? {}),
        idx.icon,
        idx.cover,
        idx.pattern ?? null,
        JSON.stringify(idx.screenshots),
        JSON.stringify(idx.about),
        JSON.stringify(idx.controls),
        JSON.stringify(targets),
        JSON.stringify(tiers),
        idx.version,
        latest.tag,
        latest.published_at,
        latest.tag,
        repo,
      )
      .run();
  }
  await updateVisibility(env, repo, ready[0] ?? null);
}

/**
 * A gizlet is listed when its newest ready release passed every check without warnings,
 * and unlisted otherwise. A visibility set by an admin is left alone.
 */
async function updateVisibility(env: Env, repo: string, newestReady: ReleaseRow | null): Promise<void> {
  let visibility: "listed" | "unlisted" = "unlisted";
  let reason: string | null = "no release has passed its checks yet";
  if (newestReady) {
    const warnings = parse<string[]>(newestReady.warnings, []);
    visibility = warnings.length ? "unlisted" : "listed";
    reason = warnings.length ? `${newestReady.tag}: ${warnings.join("; ")}` : null;
  }
  await env.DB.prepare("UPDATE gizlets SET visibility = ?, visibility_reason = ? WHERE repo = ? AND visibility_locked = 0").bind(visibility, reason, repo).run();
}

/** Set by an admin, or `auto` to hand the visibility back to the checks. */
export async function setVisibility(env: Env, repo: string, visibility: "listed" | "unlisted" | "blocked" | "auto", reason: string | null): Promise<void> {
  if (visibility === "auto") {
    await env.DB.prepare("UPDATE gizlets SET visibility_locked = 0 WHERE repo = ?").bind(repo).run();
    await refreshLatest(env, repo);
    return;
  }
  await env.DB.prepare("UPDATE gizlets SET visibility = ?, visibility_reason = ?, visibility_locked = 1 WHERE repo = ?").bind(visibility, reason, repo).run();
}

/**
 * The gizlet for a repository, indexing its latest release on first sight (installing by link
 * works for any public repository with a release). Null when its latest release has no gizlet.toml.
 * Blocked gizlets are returned too; callers refuse them.
 */
export async function ensureGizlet(env: Env, ref: RepoRef, ctx?: Waiter): Promise<GizletRow | null> {
  const g = await env.DB.prepare("SELECT * FROM gizlets WHERE repo = ?").bind(ref.key).first<GizletRow>();
  if (g?.latest_tag) {
    if (ctx && g.visibility !== "blocked" && Date.now() - g.checked_at > REFRESH_AFTER_MS) ctx.waitUntil(checkForUpdate(env, ref).catch(() => {}));
    return g;
  }
  if (g?.visibility === "blocked") return g;
  // Known repository whose releases all failed: don't refetch on every visit.
  if (g && Date.now() - g.checked_at < MISS_TTL_MS) return null;
  const miss = await env.DB.prepare("SELECT checked_at FROM misses WHERE repo = ?").bind(ref.key).first<{ checked_at: number }>();
  if (miss && Date.now() - miss.checked_at < MISS_TTL_MS) return null;
  try {
    const tag = await latestTag(env, ref);
    if (!tag) throw new NotFound(`${ref.key} has no releases`);
    await indexRelease(env, ref, tag);
  } catch (e) {
    if (e instanceof NotFound || e instanceof IndexError) {
      await env.DB.prepare("INSERT OR REPLACE INTO misses (repo, checked_at) VALUES (?, ?)").bind(ref.key, Date.now()).run();
      return null;
    }
    throw e;
  }
  const fresh = await env.DB.prepare("SELECT * FROM gizlets WHERE repo = ?").bind(ref.key).first<GizletRow>();
  return fresh?.latest_tag ? fresh : null;
}

/** Index the latest release if it is new. */
export async function checkForUpdate(env: Env, ref: RepoRef): Promise<void> {
  await env.DB.prepare("UPDATE gizlets SET checked_at = ? WHERE repo = ?").bind(Date.now(), ref.key).run();
  const tag = await latestTag(env, ref);
  if (!tag) return;
  const known = await env.DB.prepare("SELECT 1 FROM releases WHERE repo = ? AND tag = ?").bind(ref.key, tag).first();
  if (!known) await indexRelease(env, ref, tag).catch(() => {});
}

/** Cron: look for new releases of gizlets not checked recently. */
export async function refreshStale(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT owner, name_repo, repo FROM gizlets WHERE visibility != 'blocked' AND checked_at < ? ORDER BY checked_at LIMIT 40")
    .bind(Date.now() - 6 * 60 * 60 * 1000)
    .all<{ owner: string; name_repo: string; repo: string }>();
  for (const g of results) await checkForUpdate(env, { owner: g.owner, name: g.name_repo, key: g.repo }).catch(() => {});
}

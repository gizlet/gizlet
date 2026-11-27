/** Indexing releases into the registry, and deciding what is listed. */
import { parse, type GizletRow, type ReleaseRow } from "./db";
import type { Env, Waiter } from "./env";
import { fetchGizletToml, NotFound, reader, repositoryById, repositoryIdAt, type Reader, type RepoInfo } from "./github";
import { bindLinks, bindReleases } from "./links";
import { queueMirror } from "./mirror";
import { repoRef, type RepoRef } from "./repo";
import { compareVersions, IndexError, sameSpec, storedSpec } from "./schema";
import { rescore } from "./score";

const MISS_TTL_MS = 10 * 60 * 1000;
/** The cron looks at gizlets nobody viewed for this long. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** A viewed gizlet is checked for a new release at most this often (REFRESH_AFTER_SECONDS, 2 minutes). */
export function refreshAfterMs(env: Env): number {
  const s = Number.parseInt(env.REFRESH_AFTER_SECONDS, 10);
  return (Number.isFinite(s) && s >= 0 ? s : 120) * 1000;
}

export interface IndexOptions {
  repositoryId?: number;
  /** Display casing of owner/name, e.g. from the OIDC `repository` claim. */
  display?: { owner: string; name: string };
  /**
   * Index the release again even when its gizlet.toml has not changed: a publish from CI, whose
   * packages may have been rebuilt, or a release that failed before.
   */
  force?: boolean;
  /** How to read the repository; made on demand when not given. */
  reader?: Reader;
  /** What the GitHub API says about the repository (through the app only). */
  info?: RepoInfo | null;
}

/** Record a release from its gizlet.toml, point the gizlet at its newest release and queue mirroring. */
export async function indexRelease(env: Env, ref: RepoRef, tag: string, opts: IndexOptions = {}): Promise<ReleaseRow> {
  const src = opts.reader ?? (await reader(env, ref));
  const spec = await fetchGizletToml(src, ref, tag);
  if (!/^v?\d/.test(tag)) throw new IndexError(`tag ${tag} must be v<version>`);
  if (tag.replace(/^v/, "") !== spec.version) throw new IndexError(`tag ${tag} does not match gizlet.toml version ${spec.version}`);
  const now = Date.now();
  const specJson = JSON.stringify(spec);
  const existing = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? AND tag = ?").bind(ref.key, tag).first<ReleaseRow>();
  // Browsing re-indexes a release only when its gizlet.toml changed, and never re-checks a failed
  // one. A publish always does, since the packages may have been rebuilt; bytes a malware scan
  // found infected fail again when they are mirrored (src/mirror.ts), whatever the release.
  if (existing?.status === "failed" && sameSpec(existing.spec_json, spec) && !opts.force) return existing;
  const unchanged = existing && sameSpec(existing.spec_json, spec) && !opts.force;
  const display = opts.display ?? (opts.info ? { owner: opts.info.owner, name: opts.info.name } : undefined);
  const owner = display?.owner ?? ref.owner;
  const name = display?.name ?? ref.name;
  const isPrivate = opts.info ? (opts.info.private ? 1 : 0) : null;

  const learned = opts.repositoryId ?? opts.info?.id ?? null;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO gizlets (repo, owner, name_repo, repository_id, app_id, name, created_at, updated_at, checked_at, private)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, coalesce(?11, 0))
       ON CONFLICT (repo) DO UPDATE SET checked_at = excluded.checked_at,
         repository_id = coalesce(excluded.repository_id, gizlets.repository_id),
         owner = CASE WHEN ?10 THEN excluded.owner ELSE gizlets.owner END,
         name_repo = CASE WHEN ?10 THEN excluded.name_repo ELSE gizlets.name_repo END,
         private = coalesce(?11, gizlets.private)`,
    ).bind(ref.key, owner, name, learned, spec.id, spec.name, now, now, now, display ? 1 : 0, isPrivate),
    env.DB.prepare("DELETE FROM misses WHERE repo = ?").bind(ref.key),
    // Short links set while the id was unknown follow the repository from now on (src/links.ts).
    ...(learned != null ? [bindReleases(env, ref.key), ...bindLinks(env, ref.key, learned)] : []),
  ];
  if (!unchanged) {
    stmts.push(
      env.DB.prepare(
        // The repository it is indexed from: the id learnt now, else the gizlet's, as the statement above left it.
        `INSERT INTO releases (repo, tag, version, status, error, warnings, spec_json, mirrored, published_at, updated_at, repository_id)
         VALUES (?1, ?2, ?3, 'pending', NULL, '[]', ?4, 0, ?5, ?6, coalesce(?7, (SELECT repository_id FROM gizlets WHERE repo = ?1)))
         ON CONFLICT (repo, tag) DO UPDATE SET version = excluded.version, status = 'pending', error = NULL, warnings = '[]',
           spec_json = excluded.spec_json, mirrored = 0, updated_at = excluded.updated_at, revision = releases.revision + 1,
           scan = NULL, scan_report = NULL, repository_id = excluded.repository_id`,
      ).bind(ref.key, tag, spec.version, specJson, now, now, learned),
      env.DB.prepare("DELETE FROM packages WHERE repo = ? AND tag = ?").bind(ref.key, tag),
      // Size, sha256 and the R2 object are filled in by the mirror job.
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
    const idx = storedSpec(latest.spec_json);
    const targets = [...new Set(idx.packages.map((p) => p.target))].sort();
    const tiers = [...new Set(idx.packages.map((p) => p.tier))].sort();
    await env.DB.prepare(
      `UPDATE gizlets SET app_id = ?, name = ?, names = ?, description = ?, descriptions = ?, kind = ?, category = ?, tags = ?, color = ?, license = ?, links = ?,
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
        idx.kind,
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
  await rescore(env, repo);
}

/**
 * Listing is an editorial decision: the checks never list a gizlet, they only say why it is not
 * listed yet. An admin lists it (`setVisibility`), which locks the visibility, so later releases
 * leave it alone until an admin hands it back with `auto`. Unlisted gizlets still install by link.
 */
export const AWAITING_APPROVAL = "awaiting editorial approval";

async function updateVisibility(env: Env, repo: string, newestReady: ReleaseRow | null): Promise<void> {
  let reason = "no release has passed its checks yet";
  if (newestReady) {
    const warnings = parse<string[]>(newestReady.warnings, []);
    reason = warnings.length ? `${newestReady.tag}: ${warnings.join("; ")}` : AWAITING_APPROVAL;
  }
  await env.DB.prepare("UPDATE gizlets SET visibility = 'unlisted', visibility_reason = ? WHERE repo = ? AND visibility_locked = 0").bind(reason, repo).run();
}

/** Set by an admin (`listed` is the editorial approval), or `auto` to hand the visibility back to the checks, which leave it unlisted. */
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
 * works for any repository with a release that Gizlet can read: public ones, and private ones
 * the GitHub App is installed on). Null when its latest release has no gizlet.toml.
 * Blocked gizlets are returned too; callers refuse them.
 *
 * A known gizlet is answered from the registry at once; with `ctx`, a view also refreshes it in
 * the background, at most once per REFRESH_AFTER_SECONDS however many views come in.
 */
export async function ensureGizlet(env: Env, ref: RepoRef, ctx?: Waiter): Promise<GizletRow | null> {
  const g = await env.DB.prepare("SELECT * FROM gizlets WHERE repo = ?").bind(ref.key).first<GizletRow>();
  if (g?.latest_tag) {
    if (ctx && g.visibility !== "blocked" && Date.now() - g.checked_at >= refreshAfterMs(env)) {
      ctx.waitUntil(refreshGizlet(env, ref, refreshAfterMs(env)).catch((e: unknown) => console.error("refresh failed", ref.key, e)));
    }
    return g;
  }
  if (g?.visibility === "blocked") return g;
  // Known repository whose releases all failed: don't refetch on every visit.
  if (g && Date.now() - g.checked_at < MISS_TTL_MS) return null;
  const miss = await env.DB.prepare("SELECT checked_at FROM misses WHERE repo = ?").bind(ref.key).first<{ checked_at: number }>();
  if (miss && Date.now() - miss.checked_at < MISS_TTL_MS) return null;
  try {
    const src = await reader(env, ref);
    const tag = await src.latestTag();
    if (!tag) throw new NotFound(`${ref.key} has no releases`);
    await indexRelease(env, ref, tag, { reader: src, info: await src.info() });
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

/**
 * Bring a gizlet up to date with GitHub: the repository's casing and privacy, its latest release
 * (a new tag, or a changed gizlet.toml at the tag), and its score. Does nothing unless it was last
 * checked at least `olderThanMs` ago; the check time is claimed first, in one statement, so
 * concurrent views refresh it once. False when another refresh had it.
 *
 * A gizlet bound to a GitHub repository id is only refreshed from the repository with that id: when
 * the path now holds another repository (the old one deleted or moved, another created there), the
 * gizlet takes the new repository's id, so short links bound to the old one lead nowhere
 * (src/links.ts). When the path holds no repository GitHub shows (deleted, or made private for a
 * while) or GitHub cannot say, the gizlet keeps its id, so its links work again if it comes back,
 * and nothing is indexed this time.
 */
export async function refreshGizlet(env: Env, ref: RepoRef, olderThanMs: number): Promise<boolean> {
  const now = Date.now();
  const claim = await env.DB.prepare("UPDATE gizlets SET checked_at = ? WHERE repo = ? AND checked_at <= ? AND visibility != 'blocked'")
    .bind(now, ref.key, now - olderThanMs)
    .run();
  if (!claim.meta.changes) return false;
  try {
    const src = await reader(env, ref);
    const [tag, info] = await Promise.all([src.latestTag(), src.info()]);
    const bound = await env.DB.prepare("SELECT repository_id FROM gizlets WHERE repo = ?").bind(ref.key).first<{ repository_id: number | null }>();
    if (bound?.repository_id != null) {
      // The app reads the repository with its id; the public web has none, so ask GitHub.
      const id = info ? info.id : await repositoryIdAt(env, ref);
      if (id === undefined || id === null) return true;
      if (id !== bound.repository_id) {
        // Another repository has the path. If the gizlet's own moved (renamed or transferred) before
        // that, it is indexed where it is now and keeps its id, so its links follow it.
        const moved = await repositoryById(env, bound.repository_id);
        if (moved === undefined) return true;
        if (moved) await keepMoved(env, ref, bound.repository_id, moved);
        await env.DB.batch([bindReleases(env, ref.key), env.DB.prepare("UPDATE gizlets SET repository_id = ? WHERE repo = ?").bind(id, ref.key)]);
      }
    }
    if (info) {
      await env.DB.batch([
        env.DB.prepare("UPDATE gizlets SET private = ?, repository_id = coalesce(repository_id, ?), owner = ?, name_repo = ? WHERE repo = ?").bind(
          info.private ? 1 : 0,
          info.id,
          info.owner,
          info.name,
          ref.key,
        ),
        bindReleases(env, ref.key),
      ]);
    }
    if (tag) {
      await indexRelease(env, ref, tag, { reader: src, info }).catch((e: unknown) => {
        if (!(e instanceof NotFound || e instanceof IndexError)) throw e;
      });
    }
  } finally {
    // Downloads move the score between releases.
    await rescore(env, ref.key);
  }
  return true;
}

/** Index the repository with GitHub id `id` at the path it has now, as that id's gizlet. */
async function keepMoved(env: Env, from: RepoRef, id: number, now: RepoInfo): Promise<void> {
  const ref = repoRef(now.owner, now.name);
  if (!ref || ref.key === from.key) return;
  const src = await reader(env, ref);
  const tag = await src.latestTag();
  if (tag) {
    await indexRelease(env, ref, tag, { reader: src, info: (await src.info()) ?? { ...now, id } }).catch((e: unknown) => {
      if (!(e instanceof NotFound || e instanceof IndexError)) throw e;
    });
  }
  await env.DB.batch([env.DB.prepare("UPDATE gizlets SET repository_id = ? WHERE repo = ? AND repository_id IS NULL").bind(id, ref.key), bindReleases(env, ref.key)]);
}

/** Cron: refresh gizlets nobody viewed recently. */
export async function refreshStale(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT owner, name_repo, repo FROM gizlets WHERE visibility != 'blocked' AND checked_at < ? ORDER BY checked_at LIMIT 40")
    .bind(Date.now() - STALE_AFTER_MS)
    .all<{ owner: string; name_repo: string; repo: string }>();
  for (const g of results) {
    await refreshGizlet(env, { owner: g.owner, name: g.name_repo, key: g.repo }, STALE_AFTER_MS).catch((e: unknown) => console.error("refresh failed", g.repo, e));
  }
}

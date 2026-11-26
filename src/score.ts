/**
 * Marks, ratings and the score.
 *
 * Marks: `awesome` is set by an admin; `scanned` means the newest ready release's packages
 * passed a malware scan. The score (0-100) ranks gizlets:
 *   40  ratings: the mean of 1-5 stars, pulled towards 3 by 5 virtual votes, so a few votes
 *       cannot dominate (no ratings gives 20)
 *   25  downloads: log10(1 + downloads) / 4, full at 10,000
 *   15  checks: the newest ready release passed with no warnings (7.5 with warnings)
 *   10  scanned
 *   10  awesome
 */
import type { Env } from "./env";

export type Mark = "awesome" | "scanned";
export const MARKS: readonly Mark[] = ["awesome", "scanned"];
/** Marks an admin sets by hand; the others follow from the releases. */
export const ADMIN_MARKS: readonly Mark[] = ["awesome"];

const PRIOR_STARS = 3;
const PRIOR_VOTES = 5;

/** 25 points for downloads. D1 has no log10, so this part is computed here and passed in. */
export function downloadPoints(downloads: number): number {
  return 25 * Math.min(1, Math.log10(1 + Math.max(0, downloads)) / 4);
}

/**
 * The score, in SQL, from a row `x` with n and s (rating count and star sum), ready_tag and
 * warnings (the newest ready release, and its warning count), scanned, awesome (0/1) and dl
 * (downloadPoints).
 */
export const SCORE_SQL = `CAST(round(min(100, max(0,
    40 * ((${PRIOR_STARS * PRIOR_VOTES} + x.s) / (${PRIOR_VOTES}.0 + x.n) - 1) / 4
    + x.dl
    + 15 * (CASE WHEN x.ready_tag IS NULL THEN 0 WHEN x.warnings = 0 THEN 1 ELSE 0.5 END)
    + 10 * x.scanned + 10 * x.awesome))) AS INTEGER)`;

/** The mean rating, to two decimals, or null without ratings. */
export function ratingAverage(count: number, sum: number): number | null {
  return count ? Math.round((sum / count) * 100) / 100 : null;
}

/**
 * Recompute a gizlet's marks, rating aggregate and score from what they depend on, in one
 * statement: every input is read when it runs, so concurrent rescores cannot write stale
 * aggregates over newer ones. Only the download points are read before it; downloads only grow,
 * and the next rescore catches up.
 */
export async function rescore(env: Env, repo: string): Promise<void> {
  const g = await env.DB.prepare("SELECT downloads FROM gizlets WHERE repo = ?").bind(repo).first<{ downloads: number }>();
  if (!g) return;
  await env.DB.prepare(
    `UPDATE gizlets SET rating_count = x.n, rating_sum = x.s, score = ${SCORE_SQL},
       -- In the order of MARKS.
       marks = CASE WHEN x.awesome AND x.scanned THEN '["awesome","scanned"]' WHEN x.awesome THEN '["awesome"]'
                    WHEN x.scanned THEN '["scanned"]' ELSE '[]' END
     FROM (SELECT g.repo,
             (SELECT count(*) FROM ratings WHERE repo = g.repo) AS n,
             (SELECT coalesce(sum(stars), 0) FROM ratings WHERE repo = g.repo) AS s,
             r.tag AS ready_tag,
             json_array_length(coalesce(r.warnings, '[]')) AS warnings,
             coalesce(r.scan = 'clean', 0) AS scanned,
             EXISTS (SELECT 1 FROM marks WHERE repo = g.repo AND mark = 'awesome') AS awesome,
             ?2 AS dl
           FROM gizlets g LEFT JOIN releases r ON r.repo = g.repo AND r.tag = g.latest_tag AND r.status = 'ready'
          WHERE g.repo = ?1) AS x
     WHERE gizlets.repo = x.repo`,
  )
    .bind(repo, downloadPoints(g.downloads))
    .run();
}

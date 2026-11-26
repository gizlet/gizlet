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

export interface ScoreInput {
  ratingCount: number;
  ratingSum: number;
  downloads: number;
  marks: readonly string[];
  /** Warnings of the newest ready release; null when no release is ready. */
  warnings: number | null;
}

export function computeScore(s: ScoreInput): number {
  const mean = (PRIOR_STARS * PRIOR_VOTES + s.ratingSum) / (PRIOR_VOTES + s.ratingCount);
  const rating = (mean - 1) / 4;
  const downloads = Math.min(1, Math.log10(1 + Math.max(0, s.downloads)) / 4);
  const checks = s.warnings === null ? 0 : s.warnings === 0 ? 1 : 0.5;
  const score = 40 * rating + 25 * downloads + 15 * checks + (s.marks.includes("scanned") ? 10 : 0) + (s.marks.includes("awesome") ? 10 : 0);
  return Math.round(Math.min(100, Math.max(0, score)));
}

/** The mean rating, to two decimals, or null without ratings. */
export function ratingAverage(count: number, sum: number): number | null {
  return count ? Math.round((sum / count) * 100) / 100 : null;
}

function warningCount(json: string | null): number {
  try {
    const w: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(w) ? w.length : 0;
  } catch {
    return 0;
  }
}

/** Recompute a gizlet's marks, rating aggregate and score from what they depend on. */
export async function rescore(env: Env, repo: string): Promise<void> {
  const [{ results: gs }, { results: marks }, { results: agg }] = (await env.DB.batch([
    env.DB.prepare(
      `SELECT g.downloads, r.scan, r.warnings, r.tag AS ready_tag FROM gizlets g
         LEFT JOIN releases r ON r.repo = g.repo AND r.tag = g.latest_tag AND r.status = 'ready'
        WHERE g.repo = ?`,
    ).bind(repo),
    env.DB.prepare("SELECT mark FROM marks WHERE repo = ?").bind(repo),
    env.DB.prepare("SELECT count(*) AS n, coalesce(sum(stars), 0) AS s FROM ratings WHERE repo = ?").bind(repo),
  ])) as [D1Result<{ downloads: number; scan: string | null; warnings: string | null; ready_tag: string | null }>, D1Result<{ mark: string }>, D1Result<{ n: number; s: number }>];
  const g = gs[0];
  if (!g) return;
  const set = new Set(marks.map((m) => m.mark).filter((m) => ADMIN_MARKS.includes(m as Mark)));
  if (g.ready_tag && g.scan === "clean") set.add("scanned");
  const list = MARKS.filter((m) => set.has(m));
  const { n, s } = agg[0] ?? { n: 0, s: 0 };
  const score = computeScore({
    ratingCount: n,
    ratingSum: s,
    downloads: g.downloads,
    marks: list,
    warnings: g.ready_tag ? warningCount(g.warnings) : null,
  });
  await env.DB.prepare("UPDATE gizlets SET marks = ?, rating_count = ?, rating_sum = ?, score = ? WHERE repo = ?").bind(JSON.stringify(list), n, s, score, repo).run();
}

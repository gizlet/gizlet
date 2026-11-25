import type { Env } from "./env";
import { compareVersions, tierRunsOn, type Control, type Tier } from "./schema";

export type Visibility = "unlisted" | "listed" | "blocked";
export const VISIBILITIES: readonly Visibility[] = ["unlisted", "listed", "blocked"];

export interface GizletRow {
  repo: string;
  owner: string;
  name_repo: string;
  repository_id: number | null;
  app_id: string;
  name: string;
  names: string;
  description: string | null;
  descriptions: string;
  category: string;
  tags: string;
  color: string | null;
  icon: string | null;
  cover: string | null;
  screenshots: string;
  about: string;
  controls: string;
  latest_tag: string | null;
  version: string | null;
  targets: string;
  tiers: string;
  downloads: number;
  visibility: Visibility;
  visibility_reason: string | null;
  visibility_locked: number;
  created_at: number;
  updated_at: number;
  checked_at: number;
}

export interface ReleaseRow {
  repo: string;
  tag: string;
  version: string;
  status: "pending" | "mirroring" | "checking" | "ready" | "failed";
  /** Bumped each time the release is indexed again; mirror jobs carry the one they were queued for. */
  revision: number;
  error: string | null;
  warnings: string;
  index_json: string;
  mirrored: number;
  published_at: number;
  updated_at: number;
}

export interface PackageRow {
  repo: string;
  tag: string;
  file: string;
  target: string;
  tier: Tier;
  size: number;
  sha256: string;
}

export const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function dlUrl(env: Env, repo: string, tag: string, file: string): string {
  return `${env.DL_ORIGIN}/${repo}/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

export function summary(env: Env, g: GizletRow) {
  return {
    repo: g.repo,
    id: g.app_id,
    name: g.name,
    names: parse<Record<string, string>>(g.names, {}),
    description: g.description,
    descriptions: parse<Record<string, string>>(g.descriptions, {}),
    category: g.category,
    tags: parse<string[]>(g.tags, []),
    color: g.color,
    icon_url: g.icon && g.latest_tag ? dlUrl(env, g.repo, g.latest_tag, g.icon) : null,
    cover_url: g.cover && g.latest_tag ? dlUrl(env, g.repo, g.latest_tag, g.cover) : null,
    version: g.version,
    tag: g.latest_tag,
    updated_at: new Date(g.updated_at).toISOString(),
    targets: parse<string[]>(g.targets, []),
    tiers: parse<string[]>(g.tiers, []),
    downloads: g.downloads,
    visibility: g.visibility,
    share_url: `${env.SITE_ORIGIN}/${g.repo}`,
    api_url: `${env.API_ORIGIN}/v1/gizlets/${g.repo}`,
  };
}

export function packageJson(env: Env, p: PackageRow) {
  return { file: p.file, target: p.target, tier: p.tier, size: p.size, sha256: p.sha256, url: dlUrl(env, p.repo, p.tag, p.file) };
}

export async function getGizlet(env: Env, repo: string): Promise<GizletRow | null> {
  return env.DB.prepare("SELECT * FROM gizlets WHERE repo = ?").bind(repo).first<GizletRow>();
}

export async function getPackages(env: Env, repo: string, tag: string): Promise<PackageRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM packages WHERE repo = ? AND tag = ? ORDER BY tier, target").bind(repo, tag).all<PackageRow>();
  return results;
}

export async function gizletDetail(env: Env, g: GizletRow) {
  const packages = g.latest_tag ? await getPackages(env, g.repo, g.latest_tag) : [];
  const shots = parse<string[]>(g.screenshots, []);
  const tag = g.latest_tag;
  return {
    ...summary(env, g),
    owner: g.owner,
    github_url: `https://github.com/${g.owner}/${g.name_repo}`,
    screenshots: tag ? shots.map((s) => dlUrl(env, g.repo, tag, s)) : [],
    about_urls: tag ? Object.fromEntries(Object.entries(parse<Record<string, string>>(g.about, {})).map(([k, f]) => [k, dlUrl(env, g.repo, tag, f)])) : {},
    controls: parse<Control[]>(g.controls, []),
    readme_url: tag ? `${env.GITHUB_RAW}/${g.owner}/${g.name_repo}/${tag}/README.md` : null,
    packages: packages.map((p) => packageJson(env, p)),
  };
}

export function releaseJson(env: Env, r: ReleaseRow, pkgs: PackageRow[]) {
  return {
    repo: r.repo,
    tag: r.tag,
    version: r.version,
    status: r.status,
    error: r.error,
    warnings: parse<string[]>(r.warnings, []),
    mirrored: r.mirrored === 1,
    published_at: new Date(r.published_at).toISOString(),
    packages: pkgs.map((p) => packageJson(env, p)),
  };
}

export async function listReleases(env: Env, repo: string, limit = 50) {
  const { results } = await env.DB.prepare("SELECT * FROM releases WHERE repo = ? ORDER BY published_at DESC LIMIT ?").bind(repo, limit).all<ReleaseRow>();
  const { results: pkgs } = await env.DB.prepare("SELECT * FROM packages WHERE repo = ?").bind(repo).all<PackageRow>();
  return results.map((r) => releaseJson(env, r, pkgs.filter((p) => p.tag === r.tag)));
}

/**
 * The package to install on a device: newest ready release with a package for `target`
 * whose tier runs on `tier`, preferring the device's own tier.
 */
export async function pickInstall(env: Env, repo: string, target: string, tier: Tier) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, r.version AS version, r.published_at AS published_at FROM packages p
       JOIN releases r ON r.repo = p.repo AND r.tag = p.tag
      WHERE p.repo = ? AND p.target = ? AND r.status = 'ready'`,
  )
    .bind(repo, target)
    .all<PackageRow & { version: string; published_at: number }>();
  const compatible = results.filter((p) => tierRunsOn(p.tier, tier)).sort((a, b) => compareVersions(b.version, a.version) || b.published_at - a.published_at);
  if (!compatible.length) return null;
  const newest = compatible[0]!.tag;
  const sameRelease = compatible.filter((p) => p.tag === newest);
  return sameRelease.find((p) => p.tier === tier) ?? sameRelease[0]!;
}

export interface ListQuery {
  q?: string;
  category?: string;
  target?: string;
  tier?: string;
  owner?: string;
  /** Include unlisted gizlets (an owner's own list). */
  all?: boolean;
  limit: number;
  offset: number;
}

/** Search: listed gizlets only, unless `all` (never blocked ones). */
export async function listGizlets(env: Env, query: ListQuery): Promise<GizletRow[]> {
  const where = [query.all ? "visibility != 'blocked'" : "visibility = 'listed'", "latest_tag IS NOT NULL"];
  const binds: unknown[] = [];
  const bind = (v: unknown) => {
    binds.push(v);
    return `?${binds.length}`;
  };
  if (query.q) {
    const p = bind(`%${query.q.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const cols = ["lower(name)", "lower(names)", "lower(coalesce(description,''))", "lower(descriptions)", "tags", "repo"];
    where.push(`(${cols.map((c) => `${c} LIKE ${p} ESCAPE '\\'`).join(" OR ")})`);
  }
  if (query.category) where.push(`category = ${bind(query.category)}`);
  if (query.owner) where.push(`owner = ${bind(query.owner)} COLLATE NOCASE`);
  if (query.target) where.push(`EXISTS (SELECT 1 FROM json_each(gizlets.targets) WHERE value = ${bind(query.target)})`);
  // A lite device runs only lite packages.
  if (query.tier === "lite") where.push("EXISTS (SELECT 1 FROM json_each(gizlets.tiers) WHERE value = 'lite')");
  const sql = `SELECT * FROM gizlets WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, repo LIMIT ${bind(query.limit)} OFFSET ${bind(query.offset)}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all<GizletRow>();
  return results;
}

interface CollectionRow {
  id: string;
  title: string;
  titles: string;
  layout: "hero" | "row" | "grid";
  position: number;
}

/** Home lists: hand-picked collections plus automatic sections, all of listed gizlets. */
export async function featured(env: Env) {
  const listed = "g.visibility = 'listed' AND g.latest_tag IS NOT NULL";
  const [{ results: cols }, { results: items }, { results: recent }, { results: popular }] = (await env.DB.batch([
    env.DB.prepare("SELECT * FROM collections ORDER BY position, id"),
    env.DB.prepare(`SELECT ci.collection_id AS collection_id, g.* FROM collection_items ci JOIN gizlets g ON g.repo = ci.repo WHERE ${listed} ORDER BY ci.collection_id, ci.position`),
    env.DB.prepare(`SELECT g.* FROM gizlets g WHERE ${listed} ORDER BY g.updated_at DESC LIMIT 24`),
    env.DB.prepare(`SELECT g.* FROM gizlets g WHERE ${listed} AND g.downloads > 0 ORDER BY g.downloads DESC, g.updated_at DESC LIMIT 12`),
  ])) as [D1Result<CollectionRow>, D1Result<GizletRow & { collection_id: string }>, D1Result<GizletRow>, D1Result<GizletRow>];
  const section = (id: string, title: string, titles: Record<string, string>, layout: string, rows: GizletRow[]) => ({
    id,
    title,
    titles,
    layout,
    gizlets: rows.map((g) => summary(env, g)),
  });
  const curated = cols.map((c) => section(c.id, c.title, parse(c.titles, {}), c.layout, items.filter((i) => i.collection_id === c.id)));
  const hero = curated.find((c) => c.layout === "hero")?.gizlets ?? [];
  const sections = [
    ...curated.filter((c) => c.layout !== "hero"),
    section("new", "New & updated", { "zh-CN": "最新上架与更新" }, "row", recent.slice(0, 12)),
    section("games", "Games", { "zh-CN": "游戏" }, "grid", recent.filter((g) => g.category === "game")),
    section("apps", "Apps & tools", { "zh-CN": "应用与工具" }, "grid", recent.filter((g) => g.category === "app")),
    section("popular", "Most downloaded", { "zh-CN": "下载最多" }, "row", popular),
  ].filter((s) => s.gizlets.length > 0);
  return { hero: hero.length ? hero : recent.slice(0, 3).map((g) => summary(env, g)), sections };
}

import type { Env } from "./env";
import { compareVersions, tierRunsOn, type Control, type Kind, type Tier } from "./schema";
import { ratingAverage } from "./score";

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
  kind: Kind;
  /** game or app; meaningless for a service. */
  category: string;
  tags: string;
  color: string | null;
  license: string | null;
  links: string;
  icon: string | null;
  cover: string | null;
  pattern: string | null;
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
  /** 1 for a private repository, read through the GitHub App. */
  private: number;
  /** JSON array of marks: awesome, scanned (src/score.ts). */
  marks: string;
  rating_count: number;
  rating_sum: number;
  /** 0-100, see src/score.ts. */
  score: number;
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
  /** The release's gizlet.toml, parsed (GizletToml). */
  spec_json: string;
  mirrored: number;
  published_at: number;
  updated_at: number;
  /** Malware scan of this revision's packages: null until scanned, clean or infected. */
  scan: "clean" | "infected" | null;
  scan_report: string | null;
}

export interface ScanReport {
  engine: string | null;
  report_url: string | null;
  note: string | null;
  scanned_at: string;
}

export interface PackageRow {
  repo: string;
  tag: string;
  file: string;
  target: string;
  tier: Tier;
  entry: string;
  /** Known once the package is mirrored. */
  size: number | null;
  sha256: string | null;
  /** R2 key of the mirrored bytes `sha256` describes. */
  object: string | null;
  /** The release revision this row belongs to. */
  revision: number;
}

export const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** A download URL: a package (a release asset name) or art (a repository path). */
export function dlUrl(env: Env, repo: string, tag: string, file: string): string {
  return `${env.DL_ORIGIN}/${repo}/${encodeURIComponent(tag)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function summary(env: Env, g: GizletRow) {
  return {
    repo: g.repo,
    id: g.app_id,
    name: g.name,
    names: parse<Record<string, string>>(g.names, {}),
    description: g.description,
    descriptions: parse<Record<string, string>>(g.descriptions, {}),
    kind: g.kind,
    /** How an app is presented: game or app. Services have none. */
    category: g.kind === "service" ? null : g.category,
    tags: parse<string[]>(g.tags, []),
    color: g.color,
    license: g.license,
    icon_url: g.icon && g.latest_tag ? dlUrl(env, g.repo, g.latest_tag, g.icon) : null,
    cover_url: g.cover && g.latest_tag ? dlUrl(env, g.repo, g.latest_tag, g.cover) : null,
    pattern_url: g.pattern && g.latest_tag ? dlUrl(env, g.repo, g.latest_tag, g.pattern) : null,
    version: g.version,
    tag: g.latest_tag,
    updated_at: new Date(g.updated_at).toISOString(),
    targets: parse<string[]>(g.targets, []),
    tiers: parse<string[]>(g.tiers, []),
    downloads: g.downloads,
    marks: parse<string[]>(g.marks, []),
    rating: { average: ratingAverage(g.rating_count, g.rating_sum), count: g.rating_count },
    score: g.score,
    private: g.private === 1,
    visibility: g.visibility,
    share_url: `${env.SITE_ORIGIN}/${g.repo}`,
    api_url: `${env.API_ORIGIN}/v1/gizlets/${g.repo}`,
  };
}

/**
 * A package's download URL names its sha256: a republished tag can change a file's bytes, and
 * only a URL that pins them can be cached forever.
 */
export function packageUrl(env: Env, p: Pick<PackageRow, "repo" | "tag" | "file"> & { sha256: string }): string {
  return `${dlUrl(env, p.repo, p.tag, p.file)}?sha256=${p.sha256}`;
}

/** A package; `size`, `sha256` and `url` are null until it is mirrored. */
export function packageJson(env: Env, p: PackageRow) {
  const sha256 = p.sha256;
  return { file: p.file, target: p.target, tier: p.tier, entry: p.entry, size: p.size, sha256, url: sha256 ? packageUrl(env, { ...p, sha256 }) : null };
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
    links: parse<Record<string, string>>(g.links, {}),
    // A private repository's files are not public on GitHub.
    readme_url: tag && !g.private ? `${env.GITHUB_RAW}/${g.owner}/${g.name_repo}/${tag}/README.md` : null,
    packages: packages.map((p) => packageJson(env, p)),
  };
}

export function releaseJson(env: Env, r: ReleaseRow, pkgs: PackageRow[]) {
  return {
    repo: r.repo,
    tag: r.tag,
    version: r.version,
    status: r.status,
    revision: r.revision,
    error: r.error,
    warnings: parse<string[]>(r.warnings, []),
    mirrored: r.mirrored === 1,
    scan: r.scan ? { result: r.scan, ...parse<Partial<ScanReport>>(r.scan_report, {}) } : null,
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
 * whose tier runs on `tier`, preferring the device's own tier. Its `kind` is that release's
 * (an older release can differ from the newest), `app` for releases stored before kinds.
 */
export async function pickInstall(env: Env, repo: string, target: string, tier: Tier) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, r.version AS version, r.published_at AS published_at, coalesce(json_extract(r.spec_json, '$.kind'), 'app') AS kind FROM packages p
       JOIN releases r ON r.repo = p.repo AND r.tag = p.tag AND r.revision = p.revision
      WHERE p.repo = ? AND p.target = ? AND r.status = 'ready' AND p.sha256 IS NOT NULL`,
  )
    .bind(repo, target)
    .all<PackageRow & { size: number; sha256: string; version: string; published_at: number; kind: Kind }>();
  const compatible = results.filter((p) => tierRunsOn(p.tier, tier)).sort((a, b) => compareVersions(b.version, a.version) || b.published_at - a.published_at);
  if (!compatible.length) return null;
  const newest = compatible[0]!.tag;
  const sameRelease = compatible.filter((p) => p.tag === newest);
  return sameRelease.find((p) => p.tier === tier) ?? sameRelease[0]!;
}

export interface ListQuery {
  q?: string;
  kind?: Kind;
  /** game or app; only apps have one. */
  category?: string;
  target?: string;
  tier?: string;
  owner?: string;
  mark?: string;
  sort?: ListSort;
  /** Include unlisted gizlets (an owner's own list). */
  all?: boolean;
  limit: number;
  offset: number;
}

export type ListSort = "updated" | "score" | "rating" | "downloads";
export const LIST_SORTS: readonly ListSort[] = ["updated", "score", "rating", "downloads"];
const ORDER: Record<ListSort, string> = {
  updated: "updated_at DESC, repo",
  score: "score DESC, updated_at DESC, repo",
  // Rated before unrated, then by mean, then by how many rated.
  rating: "rating_count > 0 DESC, CAST(rating_sum AS REAL) / max(rating_count, 1) DESC, rating_count DESC, updated_at DESC, repo",
  downloads: "downloads DESC, updated_at DESC, repo",
};

/**
 * What public lists (search, Explore, featured) show of the gizlets table `g`: approved gizlets
 * whose shown release passed its checks. An approval outlives releases, so a gizlet whose only
 * ready release is being indexed again drops out of the lists until it is ready again.
 */
export const publicListed = (g: string) =>
  `${g}.visibility = 'listed' AND ${g}.latest_tag IS NOT NULL AND EXISTS (SELECT 1 FROM releases lr WHERE lr.repo = ${g}.repo AND lr.tag = ${g}.latest_tag AND lr.status = 'ready')`;

/** Search: listed gizlets only, unless `all` (never blocked ones). */
export async function listGizlets(env: Env, query: ListQuery): Promise<GizletRow[]> {
  const where = [query.all ? "visibility != 'blocked' AND latest_tag IS NOT NULL" : publicListed("gizlets")];
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
  if (query.kind) where.push(`kind = ${bind(query.kind)}`);
  if (query.category) where.push(`kind = 'app' AND category = ${bind(query.category)}`);
  if (query.owner) where.push(`owner = ${bind(query.owner)} COLLATE NOCASE`);
  if (query.mark) where.push(`EXISTS (SELECT 1 FROM json_each(gizlets.marks) WHERE value = ${bind(query.mark)})`);
  if (query.target) where.push(`EXISTS (SELECT 1 FROM json_each(gizlets.targets) WHERE value = ${bind(query.target)})`);
  // A lite device runs only lite packages.
  if (query.tier === "lite") where.push("EXISTS (SELECT 1 FROM json_each(gizlets.tiers) WHERE value = 'lite')");
  const sql = `SELECT * FROM gizlets WHERE ${where.join(" AND ")} ORDER BY ${ORDER[query.sort ?? "updated"]} LIMIT ${bind(query.limit)} OFFSET ${bind(query.offset)}`;
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
  const listed = publicListed("g");
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
    section("games", "Games", { "zh-CN": "游戏" }, "grid", recent.filter((g) => g.kind === "app" && g.category === "game")),
    section("apps", "Apps & tools", { "zh-CN": "应用与工具" }, "grid", recent.filter((g) => g.kind === "app" && g.category === "app")),
    section("services", "Services", { "zh-CN": "服务" }, "grid", recent.filter((g) => g.kind === "service")),
    section("popular", "Most downloaded", { "zh-CN": "下载最多" }, "row", popular),
  ].filter((s) => s.gizlets.length > 0);
  return { hero: hero.length ? hero : recent.slice(0, 3).map((g) => summary(env, g)), sections };
}

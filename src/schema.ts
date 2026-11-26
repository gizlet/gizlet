/**
 * `gizlet.toml`, the file a developer writes at the root of a gizlet's repository
 * (docs/gizlet-toml.md). The registry reads it at a release's tag.
 */
import { parse as parseToml } from "smol-toml";

export type Tier = "lite" | "full";
export type Category = "game" | "app";

export interface PackageSpec {
  target: string;
  tier: Tier;
  /** The executable's path inside the package. */
  entry: string;
  /** The release asset: `<id>-<version>-<target>-<tier>.gzl`. */
  file: string;
}

export interface GizletToml {
  id: string;
  name: string;
  names: Record<string, string>;
  version: string;
  description: string | null;
  descriptions: Record<string, string>;
  category: Category;
  tags: string[];
  color: string | null;
  license: string | null;
  runtime: number;
  /** The developer's site and social accounts, keyed by LINK_KINDS, in that order. */
  links: Record<string, string>;
  /** Repository paths at the release tag. */
  icon: string | null;
  cover: string | null;
  /** A tile repeated across the top of the gizlet's page, drawn at half its pixel size. */
  pattern: string | null;
  screenshots: string[];
  /** Long description per language: repository paths of Markdown files. */
  about: Record<string, string>;
  controls: Control[];
  packages: PackageSpec[];
}

export const BUTTONS = ["dpad", "a", "b", "x", "y", "l", "r", "start", "select"] as const;
export interface Control {
  button: (typeof BUTTONS)[number];
  action: string;
  actions: Record<string, string>;
}

/**
 * Links a gizlet may give, in the order the store shows them. `hosts` are the only hosts a link
 * of that kind may point at, so a link labelled Discord leads to Discord; `website` and
 * `mastodon` (any instance) may point anywhere. Names are the services' own.
 */
export const LINK_KINDS: readonly { key: string; name: string; hosts?: string[] }[] = [
  { key: "website", name: "Website" },
  { key: "x", name: "X", hosts: ["x.com", "twitter.com"] },
  { key: "bluesky", name: "Bluesky", hosts: ["bsky.app"] },
  { key: "mastodon", name: "Mastodon" },
  { key: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { key: "twitch", name: "Twitch", hosts: ["twitch.tv"] },
  { key: "discord", name: "Discord", hosts: ["discord.gg", "discord.com"] },
  { key: "bilibili", name: "Bilibili", hosts: ["bilibili.com", "b23.tv"] },
  { key: "weibo", name: "Weibo", hosts: ["weibo.com"] },
  { key: "xiaohongshu", name: "小红书", hosts: ["xiaohongshu.com", "xhslink.com"] },
  { key: "itch", name: "itch.io", hosts: ["itch.io"] },
  { key: "steam", name: "Steam", hosts: ["store.steampowered.com", "steamcommunity.com"] },
  { key: "patreon", name: "Patreon", hosts: ["patreon.com"] },
  { key: "kofi", name: "Ko-fi", hosts: ["ko-fi.com"] },
  { key: "afdian", name: "爱发电", hosts: ["afdian.com", "afdian.net"] },
];

/** gizlet.toml is missing a field, has a wrong one, or is not TOML. */
export class IndexError extends Error {}

const ASSET = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;
const PATH_PART = /^[A-Za-z0-9._+-]+$/;
const ID = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
export const TARGET = /^[a-z0-9_]+(-[a-z0-9_.]+){2,3}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const IMAGE = /\.(png|jpe?g|webp)$/i;
/** The largest package the registry accepts and mirrors. */
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_TOML_BYTES = 64 * 1024;
/** Runtimes a gizlet may ask for. */
export const RUNTIMES = [1];

/** A release asset name: one path segment. */
export function isAssetName(s: string): boolean {
  return ASSET.test(s) && !s.includes("..");
}

/** A canonical relative repository path: `/`-separated parts of `[A-Za-z0-9._+-]`, none `.` or `..`. */
export function isRepoPath(s: string): boolean {
  return s.length <= 200 && s.split("/").every((p) => PATH_PART.test(p) && p !== "." && p !== "..");
}

/** The release asset holding a package. */
export const packageFile = (id: string, version: string, target: string, tier: Tier) => `${id}-${version}-${target}-${tier}.gzl`;

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

function only(t: Table, field: string, keys: readonly string[]) {
  for (const k of Object.keys(t)) {
    if (!keys.includes(k)) throw new IndexError(`${field ? `${field}.` : ""}${k} is not a gizlet.toml field`);
  }
}

function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) {
    throw new IndexError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return v.trim();
}

function optStr(v: unknown, field: string, max: number): string | null {
  return v === undefined ? null : str(v, field, max);
}

function langMap(v: unknown, field: string, max: number): Record<string, string> {
  if (v === undefined) return {};
  if (!isTable(v)) throw new IndexError(`${field} must be a table of language tags`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!LANG.test(k)) throw new IndexError(`${field}.${k} is not a language tag`);
    out[k] = str(val, `${field}.${k}`, max);
  }
  return out;
}

function list(v: unknown, field: string, max: number): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new IndexError(`${field} must be a list of at most ${max}`);
  return v;
}

function repoPath(v: unknown, field: string): string {
  const s = str(v, field);
  if (!isRepoPath(s)) throw new IndexError(`${field} ${JSON.stringify(s)} is not a canonical repository path`);
  return s;
}

/** A repository path of a PNG, JPEG or WebP image. */
function image(v: unknown, field: string): string {
  const s = repoPath(v, field);
  if (!IMAGE.test(s)) throw new IndexError(`${field} must be a .png, .jpg or .webp file`);
  return s;
}

function linkMap(v: unknown): Record<string, string> {
  if (v === undefined) return {};
  if (!isTable(v)) throw new IndexError("links must be a table");
  only(v, "links", LINK_KINDS.map((k) => k.key));
  const out: Record<string, string> = {};
  for (const kind of LINK_KINDS) {
    if (v[kind.key] === undefined) continue;
    const f = `links.${kind.key}`;
    const s = str(v[kind.key], f, 300);
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new IndexError(`${f} must be an https:// URL`);
    }
    if (url.protocol !== "https:" || url.username || url.password) throw new IndexError(`${f} must be an https:// URL`);
    const host = url.hostname.toLowerCase();
    if (kind.hosts && !kind.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new IndexError(`${f} must be a link to ${kind.hosts.join(" or ")}`);
    }
    out[kind.key] = url.href;
  }
  return out;
}

function controlList(v: unknown): Control[] {
  return list(v, "controls", 12).map((c, i) => {
    const f = `controls[${i}]`;
    if (!isTable(c)) throw new IndexError(`${f} must be a table`);
    only(c, f, ["button", "action", "actions"]);
    if (!BUTTONS.includes(c.button as Control["button"])) throw new IndexError(`${f}.button must be one of ${BUTTONS.join(", ")}`);
    return { button: c.button as Control["button"], action: str(c.action, `${f}.action`, 60), actions: langMap(c.actions, `${f}.actions`, 60) };
  });
}

/** A canonical relative path inside a package: no empty, `.` or `..` parts, no `\`, `:` or NUL. */
export function isPackagePath(s: string): boolean {
  return s.length > 0 && s.length <= 200 && !/[\\:\0]/.test(s) && s.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

const FIELDS = ["id", "name", "names", "version", "description", "descriptions", "category", "tags", "color", "license", "runtime", "links", "icon", "cover", "pattern", "screenshots", "about", "controls", "packages"] as const;

/** Parse and validate gizlet.toml. */
export function parseGizletToml(text: string): GizletToml {
  let doc: Table;
  try {
    doc = parseToml(text) as Table;
  } catch (e) {
    throw new IndexError(`gizlet.toml is not valid TOML: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
  return parseSpec(doc);
}

export function parseSpec(o: Table): GizletToml {
  only(o, "", FIELDS);
  const id = str(o.id, "id", 128);
  if (!ID.test(id)) throw new IndexError("id must be reverse-DNS (lowercase)");
  const version = str(o.version, "version", 64);
  if (!VERSION.test(version)) throw new IndexError("version may only use letters, digits and . + -");
  const category = o.category ?? "app";
  if (category !== "game" && category !== "app") throw new IndexError("category must be game or app");
  const color = optStr(o.color, "color", 7);
  if (color && !COLOR.test(color)) throw new IndexError("color must be #RRGGBB");
  const runtime = o.runtime ?? 1;
  if (typeof runtime !== "number" || !RUNTIMES.includes(runtime)) throw new IndexError(`runtime must be one of ${RUNTIMES.join(", ")}`);
  const about = langMap(o.about, "about", 200);
  for (const [k, p] of Object.entries(about)) {
    if (!isRepoPath(p) || !/\.md$/i.test(p)) throw new IndexError(`about.${k} must be the repository path of a .md file`);
  }
  const pkgs = list(o.packages, "packages", 32);
  if (!pkgs.length) throw new IndexError("packages must list at least one package");
  const seen = new Set<string>();
  const packages = pkgs.map((p, i): PackageSpec => {
    const f = `packages[${i}]`;
    if (!isTable(p)) throw new IndexError(`${f} must be a table`);
    only(p, f, ["target", "tier", "entry"]);
    const target = str(p.target, `${f}.target`, 64);
    if (!TARGET.test(target)) throw new IndexError(`${f}.target is not a target triple`);
    if (p.tier !== "lite" && p.tier !== "full") throw new IndexError(`${f}.tier must be lite or full`);
    const entry = str(p.entry, `${f}.entry`);
    if (!isPackagePath(entry)) throw new IndexError(`${f}.entry ${JSON.stringify(entry)} is not a canonical path inside the package`);
    if (seen.has(`${target} ${p.tier}`)) throw new IndexError(`${f}: ${target} (${p.tier}) is listed twice`);
    seen.add(`${target} ${p.tier}`);
    const file = packageFile(id, version, target, p.tier);
    if (!isAssetName(file)) throw new IndexError(`${f}: the package name ${file} is too long`);
    return { target, tier: p.tier, entry, file };
  });
  return {
    id,
    name: str(o.name, "name", 80),
    names: langMap(o.names, "names", 80),
    version,
    description: optStr(o.description, "description", 500),
    descriptions: langMap(o.descriptions, "descriptions", 500),
    category,
    tags: list(o.tags, "tags", 12).map((t, i) => str(t, `tags[${i}]`, 32).toLowerCase()),
    color,
    license: optStr(o.license, "license", 64),
    links: linkMap(o.links),
    runtime,
    icon: o.icon === undefined ? null : image(o.icon, "icon"),
    cover: o.cover === undefined ? null : image(o.cover, "cover"),
    pattern: o.pattern === undefined ? null : image(o.pattern, "pattern"),
    screenshots: list(o.screenshots, "screenshots", 8).map((s, i) => image(s, `screenshots[${i}]`)),
    about,
    controls: controlList(o.controls),
    packages,
  };
}

/**
 * Compare versions by SemVer precedence: 1.2.3 < 1.2.4-rc.2 < 1.2.4-rc.10 < 1.2.4.
 * A leading `v` and build metadata (`+...`) are ignored; missing or non-numeric core parts count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const s = v.replace(/^v/, "").split("+", 1)[0]!;
    const dash = s.indexOf("-");
    const core = dash < 0 ? s : s.slice(0, dash);
    return { core: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: dash < 0 ? null : s.slice(dash + 1).split(".") };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return Math.sign(d);
  }
  // A release ranks above its prereleases.
  if (!x.pre || !y.pre) return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
  const numeric = /^\d+$/;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = numeric.test(p);
    const qn = numeric.test(q);
    // Numeric identifiers compare as numbers and rank below alphanumeric ones.
    if (pn && qn) return Math.sign(Number(p) - Number(q)) || (p < q ? -1 : 1);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** `lite` runs on lite and full devices; `full` only on full. */
export function tierRunsOn(pkg: Tier, device: Tier): boolean {
  return pkg === "lite" || device === "full";
}

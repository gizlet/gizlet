/** Validation of the release index `gizlet.json` (docs/api.md, schema 1). */

export type Tier = "lite" | "full";
export type Category = "game" | "app";

export interface IndexPackage {
  file: string;
  target: string;
  tier: Tier;
  size: number;
  sha256: string;
}

export interface ReleaseIndex {
  schema: 1;
  id: string;
  name: string;
  names: Record<string, string>;
  version: string;
  description: string | null;
  descriptions: Record<string, string>;
  category: Category;
  tags: string[];
  color: string | null;
  icon: string | null;
  cover: string | null;
  screenshots: string[];
  /** Long description per language: asset names of Markdown files. */
  about: Record<string, string>;
  controls: Control[];
  packages: IndexPackage[];
}

export const BUTTONS = ["dpad", "a", "b", "x", "y", "l", "r", "start", "select"] as const;
export interface Control {
  button: (typeof BUTTONS)[number];
  action: string;
  actions: Record<string, string>;
}

export class IndexError extends Error {}

const ASSET = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;
const ID = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;
const TARGET = /^[a-z0-9_]+(-[a-z0-9_.]+){2,3}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** The largest package the registry accepts and mirrors. */
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|webp)$/i;

export function isAssetName(s: string): boolean {
  return ASSET.test(s) && !s.includes("..");
}

function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) {
    throw new IndexError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return v.trim();
}

function optStr(v: unknown, field: string, max: number): string | null {
  return v === undefined || v === null || v === "" ? null : str(v, field, max);
}

function langMap(v: unknown, field: string, max: number): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new IndexError(`${field} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(k)) throw new IndexError(`${field} key ${k} is not a language tag`);
    out[k] = str(val, `${field}.${k}`, max);
  }
  return out;
}

/** A release asset that is a PNG, JPEG or WebP image. */
function image(v: unknown, field: string): string {
  const s = asset(v, field);
  if (!IMAGE.test(s)) throw new IndexError(`${field} must name a .png, .jpg or .webp release asset`);
  return s;
}

function asset(v: unknown, field: string): string {
  const s = str(v, field);
  if (!isAssetName(s)) throw new IndexError(`${field} ${JSON.stringify(s)} is not a release asset name`);
  return s;
}

function aboutMap(v: unknown): Record<string, string> {
  const map = langMap(v, "about", 200);
  for (const [k, file] of Object.entries(map)) {
    if (!isAssetName(file) || !/\.md$/i.test(file)) throw new IndexError(`about.${k} must name a .md release asset`);
  }
  return map;
}

function controlList(v: unknown): Control[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 12) throw new IndexError("controls must list at most 12 entries");
  return v.map((c, i) => {
    if (typeof c !== "object" || c === null) throw new IndexError(`controls[${i}] must be an object`);
    const q = c as Record<string, unknown>;
    if (!BUTTONS.includes(q.button as Control["button"])) {
      throw new IndexError(`controls[${i}].button must be one of ${BUTTONS.join(", ")}`);
    }
    return {
      button: q.button as Control["button"],
      action: str(q.action, `controls[${i}].action`, 60),
      actions: langMap(q.actions, `controls[${i}].actions`, 60),
    };
  });
}

export function parseIndex(raw: unknown): ReleaseIndex {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new IndexError("gizlet.json must be an object");
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1) throw new IndexError("schema must be 1");
  const id = str(o.id, "id", 128);
  if (!ID.test(id)) throw new IndexError("id must be reverse-DNS (lowercase)");
  const category = o.category ?? "app";
  if (category !== "game" && category !== "app") throw new IndexError("category must be game or app");
  const color = optStr(o.color, "color", 7);
  if (color && !COLOR.test(color)) throw new IndexError("color must be #RRGGBB");
  const tags = Array.isArray(o.tags) ? o.tags.slice(0, 12).map((t, i) => str(t, `tags[${i}]`, 32).toLowerCase()) : [];
  const screenshots = Array.isArray(o.screenshots) ? o.screenshots.slice(0, 8).map((s, i) => image(s, `screenshots[${i}]`)) : [];
  if (!Array.isArray(o.packages) || o.packages.length === 0 || o.packages.length > 32) {
    throw new IndexError("packages must list 1 to 32 packages");
  }
  const files = new Set<string>();
  const packages = o.packages.map((p, i): IndexPackage => {
    if (typeof p !== "object" || p === null) throw new IndexError(`packages[${i}] must be an object`);
    const q = p as Record<string, unknown>;
    const file = asset(q.file, `packages[${i}].file`);
    if (!file.endsWith(".gzl")) throw new IndexError(`packages[${i}].file must end with .gzl`);
    if (files.has(file)) throw new IndexError(`packages[${i}].file is listed twice`);
    files.add(file);
    const target = str(q.target, `packages[${i}].target`, 64);
    if (!TARGET.test(target)) throw new IndexError(`packages[${i}].target is not a target triple`);
    if (q.tier !== "lite" && q.tier !== "full") throw new IndexError(`packages[${i}].tier must be lite or full`);
    if (typeof q.size !== "number" || !Number.isSafeInteger(q.size) || q.size <= 0 || q.size > MAX_PACKAGE_BYTES) {
      throw new IndexError(`packages[${i}].size must be a positive byte count up to 1 GiB`);
    }
    if (typeof q.sha256 !== "string" || !HEX64.test(q.sha256)) throw new IndexError(`packages[${i}].sha256 must be 64 lowercase hex digits`);
    return { file, target, tier: q.tier, size: q.size, sha256: q.sha256 };
  });
  return {
    schema: 1,
    id,
    name: str(o.name, "name", 80),
    names: langMap(o.names, "names", 80),
    version: str(o.version, "version", 64),
    description: optStr(o.description, "description", 500),
    descriptions: langMap(o.descriptions, "descriptions", 500),
    category,
    tags,
    color,
    icon: o.icon === undefined || o.icon === null ? null : image(o.icon, "icon"),
    cover: o.cover === undefined || o.cover === null ? null : image(o.cover, "cover"),
    screenshots,
    about: aboutMap(o.about),
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

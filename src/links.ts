/**
 * Short links: gizlet.io/<id> opens a gizlet's page. An id names one gizlet, and a gizlet has at
 * most one current id. Changing or removing it keeps the old id pointing at the same gizlet for
 * LINK_HOLD_MS, so links already shared keep working and nobody else can take it meanwhile.
 *
 * Ids are lowercase letters, digits and single hyphens, start with a letter and end with a letter
 * or digit, LINK_MIN to LINK_MAX characters long. Each account may claim ids of at least its own
 * minimum length (DEFAULT_LINK_MIN_LENGTH unless an admin changed it); admins may set any valid id.
 * The site's own paths and a few words we may want later are reserved.
 *
 * A link is bound to the GitHub repository id where it is known, so it follows a renamed repository.
 */
import type { GizletRow } from "./db";
import type { Env } from "./env";

export const LINK_MIN = 3;
export const LINK_MAX = 32;
export const DEFAULT_LINK_MIN_LENGTH = 6;
export const LINK_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

const LINK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Paths the site serves, and words kept for later. */
export const RESERVED = new Set([
  // Routes of src/site.ts and src/index.ts.
  "account", "login", "device", "devices", "explore", "install", "flash", "open", "static", "favicon",
  // Kept for later.
  "about", "admin", "api", "app", "apps", "auth", "blog", "browse", "dashboard", "developer", "developers", "dl", "docs",
  "download", "downloads", "gizlet", "gizlets", "github", "help", "home", "legal", "link", "links", "logout", "mail", "me",
  "new", "news", "official", "privacy", "profile", "register", "releases", "search", "security", "settings", "signin",
  "signout", "signup", "status", "store", "support", "team", "terms", "u", "user", "users", "www",
]);

export type LinkProblem = "format" | "reserved" | "too_short" | "too_long";

export const normalizeLinkId = (id: string) => id.trim().toLowerCase();

/** What is wrong with an id for an account whose ids must be at least `minLength` long, or null. */
export function linkProblem(id: string, minLength = LINK_MIN): LinkProblem | null {
  if (id.length > LINK_MAX) return "too_long";
  if (!LINK_ID.test(id)) return "format";
  if (RESERVED.has(id)) return "reserved";
  if (id.length < Math.max(LINK_MIN, minLength)) return "too_short";
  return null;
}

/** An account's minimum id length; null in the database is the default. */
export const minLengthOf = (n: number | null | undefined) => (typeof n === "number" && Number.isInteger(n) ? n : DEFAULT_LINK_MIN_LENGTH);

export interface LinkRow {
  id: string;
  /** The gizlet it belongs to (gizletKey): `id:<GitHub repository id>`, or `repo:<repository>` where the id is unknown. */
  gizlet: string;
  repo: string;
  repository_id: number | null;
  user_id: string | null;
  /** Null for a gizlet's current id; else when a replaced or removed id stops working. */
  expires_at: number | null;
  created_at: number;
}

type Gizlet = Pick<GizletRow, "repo" | "repository_id">;

/** A gizlet's identity in `links.gizlet`: its GitHub repository id where known, else its repository. */
export const gizletKey = (g: Gizlet) => (g.repository_id != null ? `id:${g.repository_id}` : `repo:${g.repo}`);

/** The keys a gizlet's links may carry: its id, and its repository from before the id was known. */
const keysOf = (g: Gizlet) => JSON.stringify(g.repository_id != null ? [`id:${g.repository_id}`, `repo:${g.repo}`] : [`repo:${g.repo}`]);

/** Whether a link belongs to a gizlet. A link bound to a repository id never belongs to another repository at its path. */
export const sameGizlet = (l: Pick<LinkRow, "gizlet">, g: Gizlet) => (JSON.parse(keysOf(g)) as string[]).includes(l.gizlet);

const live = (l: LinkRow, now: number) => l.expires_at === null || l.expires_at > now;

export async function getLink(env: Env, id: string): Promise<LinkRow | null> {
  return env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
}

/**
 * The gizlet a link points at: by repository id (the newest name it was indexed under). Its old
 * path only counts while the gizlet there has no other id: a repository deleted and created again
 * at the same path is another gizlet.
 */
async function linkTarget(env: Env, l: LinkRow): Promise<GizletRow | null> {
  if (l.repository_id != null) {
    const g = await env.DB.prepare("SELECT * FROM gizlets WHERE repository_id = ? ORDER BY updated_at DESC LIMIT 1").bind(l.repository_id).first<GizletRow>();
    if (g) return g;
    return env.DB.prepare("SELECT * FROM gizlets WHERE repo = ? AND repository_id IS NULL").bind(l.repo).first<GizletRow>();
  }
  return env.DB.prepare("SELECT * FROM gizlets WHERE repo = ?").bind(l.repo).first<GizletRow>();
}

/** Where an id leads now: a live link to a gizlet that is not blocked. */
export async function resolveLink(env: Env, id: string): Promise<{ link: LinkRow; gizlet: GizletRow } | null> {
  const l = await getLink(env, id);
  if (!l || !live(l, Date.now())) return null;
  const g = await linkTarget(env, l);
  if (!g || g.visibility === "blocked") return null;
  return { link: l, gizlet: g };
}

/** A gizlet's current id, if it has one. */
export async function currentLink(env: Env, g: Gizlet): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM links WHERE expires_at IS NULL AND gizlet IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 1")
    .bind(keysOf(g))
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Current ids of many gizlets, by repository. */
export async function currentLinks(env: Env, gizlets: Gizlet[]): Promise<Map<string, string>> {
  if (!gizlets.length) return new Map();
  const keys = gizlets.flatMap((g) => JSON.parse(keysOf(g)) as string[]);
  const { results } = await env.DB.prepare("SELECT * FROM links WHERE expires_at IS NULL AND gizlet IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC")
    .bind(JSON.stringify(keys))
    .all<LinkRow>();
  const out = new Map<string, string>();
  for (const g of gizlets) {
    const l = results.find((x) => sameGizlet(x, g));
    if (l) out.set(g.repo, l.id);
  }
  return out;
}

export type ClaimResult = { ok: true; id: string } | { ok: false; code: "taken" };

/**
 * Make `id` the gizlet's current id. Its previous id, if any, is held for LINK_HOLD_MS. An id held
 * for this gizlet may be taken back; one live for another gizlet is `taken`, unless `force` (admins),
 * which moves it.
 *
 * One batch (a transaction) checks and writes, so concurrent claims cannot both win an id, and the
 * `links_current` index keeps one current id per gizlet.
 */
export async function claimLink(env: Env, g: Gizlet, id: string, userId: string | null, force = false): Promise<ClaimResult> {
  const now = Date.now();
  const keys = keysOf(g);
  const [, claimed] = await env.DB.batch([
    // Hold the gizlet's other current ids, if `id` is free for it.
    env.DB.prepare(
      `UPDATE links SET expires_at = ?1 WHERE expires_at IS NULL AND gizlet IN (SELECT value FROM json_each(?2)) AND id != ?3
         AND (?4 OR NOT EXISTS (SELECT 1 FROM links o WHERE o.id = ?3 AND o.gizlet NOT IN (SELECT value FROM json_each(?2)) AND (o.expires_at IS NULL OR o.expires_at > ?5)))`,
    ).bind(now + LINK_HOLD_MS, keys, id, force ? 1 : 0, now),
    // Take `id`: new, already the gizlet's, lapsed, or moved by an admin.
    env.DB.prepare(
      `INSERT INTO links (id, gizlet, repo, repository_id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
       ON CONFLICT (id) DO UPDATE SET gizlet = excluded.gizlet, repo = excluded.repo, repository_id = excluded.repository_id, user_id = excluded.user_id,
         expires_at = NULL, created_at = excluded.created_at
       WHERE ?7 OR links.gizlet IN (SELECT value FROM json_each(?8)) OR (links.expires_at IS NOT NULL AND links.expires_at <= ?6)`,
    ).bind(id, gizletKey(g), g.repo, g.repository_id ?? null, userId, now, force ? 1 : 0, keys),
  ]);
  return claimed!.meta.changes > 0 ? { ok: true, id } : { ok: false, code: "taken" };
}

/** Stop using the gizlet's current id; it keeps working, and stays the gizlet's, for LINK_HOLD_MS. */
export async function releaseLink(env: Env, g: Gizlet): Promise<string | null> {
  const row = await env.DB.prepare("UPDATE links SET expires_at = ? WHERE expires_at IS NULL AND gizlet IN (SELECT value FROM json_each(?)) RETURNING id")
    .bind(Date.now() + LINK_HOLD_MS, keysOf(g))
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** The short URL for an id, on the site's own host. */
export const shortUrl = (env: Pick<Env, "SITE_ORIGIN">, id: string) => `${env.SITE_ORIGIN}/${id}`;

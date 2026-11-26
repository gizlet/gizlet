/**
 * Reading releases from GitHub.
 *
 * Where the GitHub App (gizlet-bot) is installed, a repository is read through the REST API with
 * an installation token, which also reaches private repositories:
 *   GET /repos/<o>/<r>                          -> id, display casing, private
 *   GET /repos/<o>/<r>/releases/latest          -> the tag
 *   GET /repos/<o>/<r>/releases/tags/<tag>      -> asset ids
 *   GET /repos/<o>/<r>/releases/assets/<id>     -> 302 to a short-lived download URL
 * Elsewhere (no app configured, or not installed there) public github.com web URLs are used,
 * which need no credentials:
 *   /<o>/<r>/releases/latest                    -> 302 to /releases/tag/<tag>
 *   /<o>/<r>/releases/download/<tag>/<asset>    -> the asset
 */
import { SignJWT } from "jose";
import type { Env } from "./env";
import { importRsaKey } from "./pem";
import type { RepoRef } from "./repo";
import { IndexError, parseIndex, type ReleaseIndex } from "./schema";

export class NotFound extends Error {}
export class UpstreamError extends Error {}

const UA = "gizlet (+https://gizlet.io)";
const MAX_INDEX_BYTES = 256 * 1024;
/** How long to remember which installation covers a repository, or that none does. */
const INSTALLATION_TTL_MS = 10 * 60 * 1000;
const NO_INSTALLATION_TTL_MS = 2 * 60 * 1000;

export function assetUrl(env: Env, owner: string, name: string, tag: string, file: string): string {
  return `${env.GITHUB_WEB}/${owner}/${name}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

export function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", UA);
  return fetch(url, { ...init, headers });
}

/** What the API says about a repository. */
export interface RepoInfo {
  id: number;
  owner: string;
  name: string;
  private: boolean;
}

/** One repository's releases, read through the app or the public web. */
export interface Reader {
  readonly via: "app" | "web";
  /** Tag of the latest release, or null when it has none / does not exist / cannot be read. */
  latestTag(): Promise<string | null>;
  /** A release asset; 404 when the release or asset is missing. */
  asset(tag: string, file: string): Promise<Response>;
  /** A URL anyone can download the asset from for the next few minutes, or null when it is missing. */
  downloadUrl(tag: string, file: string): Promise<string | null>;
  /** The repository's id, casing and privacy; null through the web. */
  info(): Promise<RepoInfo | null>;
}

/** The reader for a repository: through the app where it is installed, else the public web. */
export async function reader(env: Env, ref: RepoRef): Promise<Reader> {
  const web = new WebReader(env, ref);
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_PRIVATE_KEY) return web;
  const installation = await installationFor(env, ref).catch((e: unknown) => {
    console.error("GitHub App installation lookup failed", ref.key, e);
    return null;
  });
  return installation === null ? web : new AppReader(env, ref, installation, web);
}

export async function fetchIndex(src: Reader, ref: RepoRef, tag: string): Promise<ReleaseIndex> {
  const res = await src.asset(tag, "gizlet.json");
  if (res.status === 404) {
    await res.body?.cancel();
    throw new NotFound(`release ${tag} of ${ref.key} has no gizlet.json`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for gizlet.json`);
  }
  const text = await readCapped(res, MAX_INDEX_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(text));
  } catch {
    throw new IndexError("gizlet.json is not valid JSON");
  }
  return parseIndex(json);
}

class WebReader implements Reader {
  readonly via = "web";
  private env: Env;
  private ref: RepoRef;

  constructor(env: Env, ref: RepoRef) {
    this.env = env;
    this.ref = ref;
  }

  async latestTag(): Promise<string | null> {
    const res = await ghFetch(`${this.env.GITHUB_WEB}/${this.ref.owner}/${this.ref.name}/releases/latest`, { redirect: "manual" });
    await res.body?.cancel();
    if (res.status === 404) return null;
    if (res.status < 300 || res.status >= 400) throw new UpstreamError(`GitHub answered ${res.status} for the latest release`);
    const loc = res.headers.get("location") ?? "";
    const m = /\/releases\/tag\/([^/?#]+)$/.exec(loc);
    return m ? decodeURIComponent(m[1]!) : null;
  }

  asset(tag: string, file: string): Promise<Response> {
    return ghFetch(assetUrl(this.env, this.ref.owner, this.ref.name, tag, file));
  }

  async downloadUrl(tag: string, file: string): Promise<string | null> {
    return assetUrl(this.env, this.ref.owner, this.ref.name, tag, file);
  }

  async info(): Promise<RepoInfo | null> {
    return null;
  }
}

interface ReleaseJson {
  tag_name: string;
  assets: { id: number; name: string }[];
}

class AppReader implements Reader {
  readonly via = "app";
  private releases = new Map<string, Promise<Map<string, number> | null>>();
  /** Set once the installation turns out not to reach the repository; the web is used from then on. */
  private fallback: Reader | null = null;

  private env: Env;
  private ref: RepoRef;
  private installation: number;
  private web: Reader;

  constructor(env: Env, ref: RepoRef, installation: number, web: Reader) {
    this.env = env;
    this.ref = ref;
    this.installation = installation;
    this.web = web;
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await installationToken(this.env, this.installation);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-github-api-version", "2022-11-28");
    if (!headers.has("accept")) headers.set("accept", "application/vnd.github+json");
    return ghFetch(`${this.env.GITHUB_API}/repos/${this.ref.owner}/${this.ref.name}${path}`, { ...init, headers });
  }

  /**
   * 401, 403 or 404: the installation does not reach this repository, or lacks Contents: read
   * (GitHub answers 404 for what a token may not see). The public web may still have it.
   */
  private denied(res: Response): boolean {
    if (res.status !== 401 && res.status !== 403 && res.status !== 404) return false;
    if (res.headers.get("x-ratelimit-remaining") === "0") throw new UpstreamError("GitHub API rate limit reached");
    if (res.status !== 404) console.warn("GitHub App cannot read", this.ref.key, res.status);
    this.fallback = this.web;
    return true;
  }

  async latestTag(): Promise<string | null> {
    if (this.fallback) return this.fallback.latestTag();
    const res = await this.api("/releases/latest");
    if (this.denied(res)) {
      await res.body?.cancel();
      return this.web.latestTag();
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(`GitHub answered ${res.status} for the latest release`);
    }
    const rel = (await res.json()) as ReleaseJson;
    this.releases.set(rel.tag_name, Promise.resolve(assetIds(rel)));
    return rel.tag_name;
  }

  private release(tag: string): Promise<Map<string, number> | null> {
    let p = this.releases.get(tag);
    if (!p) {
      p = (async () => {
        const res = await this.api(`/releases/tags/${encodeURIComponent(tag)}`);
        if (this.denied(res)) {
          await res.body?.cancel();
          return null;
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new UpstreamError(`GitHub answered ${res.status} for release ${tag}`);
        }
        return assetIds((await res.json()) as ReleaseJson);
      })();
      p.catch(() => this.releases.delete(tag));
      this.releases.set(tag, p);
    }
    return p;
  }

  /** The asset's short-lived download URL, null when it is missing, undefined when the app cannot read it. */
  private async location(tag: string, file: string): Promise<string | null | undefined> {
    const assets = await this.release(tag);
    if (!assets) return undefined;
    const id = assets.get(file);
    if (id === undefined) return null;
    // The API redirects to a signed URL on another host, which refuses our Authorization header.
    const res = await this.api(`/releases/assets/${id}`, { headers: { accept: "application/octet-stream" }, redirect: "manual" });
    await res.body?.cancel();
    if (this.denied(res)) return undefined;
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) throw new UpstreamError(`GitHub answered ${res.status} for ${file}`);
    return loc;
  }

  async asset(tag: string, file: string): Promise<Response> {
    if (this.fallback) return this.fallback.asset(tag, file);
    const loc = await this.location(tag, file);
    if (loc === undefined) return this.web.asset(tag, file);
    if (loc === null) return new Response("Not Found", { status: 404 });
    return ghFetch(loc);
  }

  async downloadUrl(tag: string, file: string): Promise<string | null> {
    if (this.fallback) return this.fallback.downloadUrl(tag, file);
    const loc = await this.location(tag, file);
    return loc === undefined ? this.web.downloadUrl(tag, file) : loc;
  }

  async info(): Promise<RepoInfo | null> {
    const res = await this.api("");
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const r = (await res.json()) as { id: number; name: string; private: boolean; owner: { login: string } };
    return { id: r.id, owner: r.owner.login, name: r.name, private: r.private };
  }
}

function assetIds(rel: ReleaseJson): Map<string, number> {
  return new Map(rel.assets.map((a) => [a.name, a.id]));
}

// --- GitHub App authentication ------------------------------------------------------------------

/** Per isolate: the installation that covers each repository (null: none), and installation tokens. */
const installations = new Map<string, { id: number | null; until: number }>();
const tokens = new Map<number, { token: Promise<string>; until: number }>();
let signingKey: { pem: string; key: Promise<CryptoKey> } | undefined;

/** A JWT that authenticates as the app itself, valid for 9 minutes. */
async function appJwt(env: Env): Promise<string> {
  const pem = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  if (signingKey?.pem !== pem) signingKey = { pem, key: importRsaKey(pem) };
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(env.GITHUB_APP_CLIENT_ID!)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(await signingKey.key);
}

async function appFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await appJwt(env)}`);
  headers.set("accept", "application/vnd.github+json");
  headers.set("x-github-api-version", "2022-11-28");
  return ghFetch(`${env.GITHUB_API}${path}`, { ...init, headers });
}

/** The installation of the app that covers a repository, or null when it is not installed there. */
async function installationFor(env: Env, ref: RepoRef): Promise<number | null> {
  const hit = installations.get(ref.key);
  if (hit && hit.until > Date.now()) return hit.id;
  const res = await appFetch(env, `/repos/${ref.owner}/${ref.name}/installation`);
  let id: number | null = null;
  if (res.ok) id = ((await res.json()) as { id: number }).id;
  else {
    await res.body?.cancel();
    if (res.status !== 404) throw new UpstreamError(`GitHub answered ${res.status} for the app installation`);
  }
  installations.set(ref.key, { id, until: Date.now() + (id === null ? NO_INSTALLATION_TTL_MS : INSTALLATION_TTL_MS) });
  return id;
}

/** An installation access token, reused until 5 minutes before it expires. */
function installationToken(env: Env, installation: number): Promise<string> {
  const hit = tokens.get(installation);
  if (hit && hit.until > Date.now()) return hit.token;
  const token = (async () => {
    const res = await appFetch(env, `/app/installations/${installation}/access_tokens`, { method: "POST" });
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(`GitHub answered ${res.status} for an installation token`);
    }
    const t = (await res.json()) as { token: string; expires_at: string };
    tokens.set(installation, { token: Promise.resolve(t.token), until: Date.parse(t.expires_at) - 5 * 60 * 1000 });
    return t.token;
  })();
  token.catch(() => tokens.delete(installation));
  tokens.set(installation, { token, until: Date.now() + 60 * 1000 });
  return token;
}

// --- Reading bodies ------------------------------------------------------------------------------

/** The response body, refusing more than `max` bytes. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) {
    await res.body?.cancel();
    throw new IndexError(`file is larger than ${max} bytes`);
  }
  return readStream(res.body!, max);
}

export async function readStream(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new IndexError(`file is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

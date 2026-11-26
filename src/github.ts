/**
 * Reading releases from GitHub.
 *
 * Where the GitHub App (gizlet-bot) is installed, a repository is read through the REST API with
 * an installation token, which also reaches private repositories:
 *   GET /repos/<o>/<r>                          -> id, display casing, private
 *   GET /repos/<o>/<r>/releases/latest          -> the tag
 *   GET /repos/<o>/<r>/releases/tags/<tag>      -> asset ids
 *   GET /repos/<o>/<r>/releases/assets/<id>     -> 302 to a short-lived download URL
 *   GET /repos/<o>/<r>/contents/<path>?ref=<tag> -> a repository file (gizlet.toml, art)
 * Elsewhere (no app configured, or not installed there) public web URLs are used, which need no
 * credentials:
 *   github.com/<o>/<r>/releases/latest                   -> 302 to /releases/tag/<tag>
 *   github.com/<o>/<r>/releases/download/<tag>/<asset>   -> a release asset (packages)
 *   raw.githubusercontent.com/<o>/<r>/<tag>/<path>       -> a repository file
 */
import { SignJWT } from "jose";
import type { Env } from "./env";
import { importRsaKey } from "./pem";
import type { RepoRef } from "./repo";
import { IndexError, MAX_TOML_BYTES, parseGizletToml, type GizletToml } from "./schema";

export class NotFound extends Error {}
export class UpstreamError extends Error {}
/** GitHub refused the app an installation token (a suspended installation, say). */
class TokenDenied extends Error {}

const UA = "gizlet (+https://gizlet.io)";
/** How long to remember which installation covers a repository, or that none does. */
const INSTALLATION_TTL_MS = 10 * 60 * 1000;
const NO_INSTALLATION_TTL_MS = 2 * 60 * 1000;

export function assetUrl(env: Env, owner: string, name: string, tag: string, file: string): string {
  return `${env.GITHUB_WEB}/${owner}/${name}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

/** A repository file at a tag, on the public web. */
export function rawUrl(env: Env, owner: string, name: string, tag: string, path: string): string {
  return `${env.GITHUB_RAW}/${owner}/${name}/${encodeURIComponent(tag)}/${encodeRepoPath(path)}`;
}

const encodeRepoPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

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

export type Download = { url: string } | { response: Response };

/** One repository's releases, read through the app or the public web. */
export interface Reader {
  readonly via: "app" | "web";
  /** Tag of the latest release, or null when it has none / does not exist / cannot be read. */
  latestTag(): Promise<string | null>;
  /** A release asset; 404 when the release or asset is missing. */
  asset(tag: string, file: string): Promise<Response>;
  /** A repository file at a tag (gizlet.toml, art); 404 when it is missing. */
  file(tag: string, path: string): Promise<Response>;
  /**
   * How a client can get the asset: a URL anyone can download it from for the next few minutes,
   * or, when GitHub hands over the bytes instead of a URL, the response itself (for `range`, a
   * 206 when GitHub honours it). Null when it is missing.
   */
  download(tag: string, file: string, range?: string): Promise<Download | null>;
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

/** The repository's gizlet.toml at a release tag. */
export async function fetchGizletToml(src: Reader, ref: RepoRef, tag: string): Promise<GizletToml> {
  const res = await src.file(tag, "gizlet.toml");
  if (res.status === 404) {
    await res.body?.cancel();
    throw new NotFound(`${ref.key} has no gizlet.toml at ${tag}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for gizlet.toml`);
  }
  const bytes = await readCapped(res, MAX_TOML_BYTES).catch((e: unknown) => {
    throw e instanceof IndexError ? new IndexError(`gizlet.toml is larger than ${MAX_TOML_BYTES} bytes`) : e;
  });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new IndexError("gizlet.toml is not UTF-8");
  }
  return parseGizletToml(text);
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

  file(tag: string, path: string): Promise<Response> {
    return ghFetch(rawUrl(this.env, this.ref.owner, this.ref.name, tag, path));
  }

  async download(tag: string, file: string, _range?: string): Promise<Download | null> {
    return { url: assetUrl(this.env, this.ref.owner, this.ref.name, tag, file) };
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

  private api(path: string, init: RequestInit = {}): Promise<Response> {
    return this.apiUrl(`${this.env.GITHUB_API}/repos/${this.ref.owner}/${this.ref.name}${path}`, init);
  }

  /** An authenticated request to the GitHub API, at any URL on it. */
  private async apiUrl(url: string, init: RequestInit = {}): Promise<Response> {
    let token: string;
    try {
      token = await installationToken(this.env, this.installation);
    } catch (e) {
      // Treated like any other denial: the caller falls back to the public web.
      if (e instanceof TokenDenied) return new Response(null, { status: 403 });
      throw e;
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-github-api-version", "2022-11-28");
    if (!headers.has("accept")) headers.set("accept", "application/vnd.github+json");
    return ghFetch(url, { ...init, headers });
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

  /**
   * The asset from the API: a signed URL to follow, or the bytes themselves (GitHub answers
   * either way). Null when it is missing, undefined when the app cannot read it.
   */
  private async fetchAsset(tag: string, file: string, range?: string): Promise<Download | null | undefined> {
    const assets = await this.release(tag);
    if (!assets) return undefined;
    const id = assets.get(file);
    if (id === undefined) return null;
    // A redirect to a signed URL on another host, which refuses our Authorization header, is
    // followed separately, without it. One within the API (a renamed or transferred repository:
    // /repositories/<id>/releases/assets/<id>) is followed here, with the same headers.
    const headers: Record<string, string> = { accept: "application/octet-stream" };
    if (range) headers.range = range;
    const init: RequestInit = { headers, redirect: "manual" };
    let res = await this.api(`/releases/assets/${id}`, init);
    for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
      const next = res.headers.get("location");
      if (!next || !/^\/(repos|repositories)\//.test(next.startsWith(this.env.GITHUB_API) ? next.slice(this.env.GITHUB_API.length) : "")) break;
      await res.body?.cancel();
      res = await this.apiUrl(next, init);
    }
    if (res.status === 200 || res.status === 206 || res.status === 416) return { response: res };
    await res.body?.cancel();
    if (this.denied(res)) return undefined;
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) throw new UpstreamError(`GitHub answered ${res.status} for ${file}`);
    return { url: loc };
  }

  async asset(tag: string, file: string): Promise<Response> {
    if (this.fallback) return this.fallback.asset(tag, file);
    const got = await this.fetchAsset(tag, file);
    if (got === undefined) return this.web.asset(tag, file);
    if (got === null) return new Response("Not Found", { status: 404 });
    return "response" in got ? got.response : ghFetch(got.url);
  }

  async file(tag: string, path: string): Promise<Response> {
    if (this.fallback) return this.fallback.file(tag, path);
    const res = await this.api(`/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(tag)}`, { headers: { accept: "application/vnd.github.raw" } });
    // A 404 usually means the file is missing; the public web answers either way, without giving
    // up on the app for the release's packages. 401 and 403 do give up on it.
    if (res.status === 404) {
      await res.body?.cancel();
      return this.web.file(tag, path);
    }
    if (this.denied(res)) {
      await res.body?.cancel();
      return this.web.file(tag, path);
    }
    return res;
  }

  async download(tag: string, file: string, range?: string): Promise<Download | null> {
    if (this.fallback) return this.fallback.download(tag, file, range);
    const got = await this.fetchAsset(tag, file, range);
    return got === undefined ? this.web.download(tag, file, range) : got;
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

// --- As a signed-in user ------------------------------------------------------------------------

/** GitHub no longer accepts the user's token (revoked, or the OAuth app was removed): link GitHub again. */
export class UserTokenRejected extends Error {}

async function userFetch(env: Pick<Env, "GITHUB_API">, token: string, path: string): Promise<Response> {
  const res = await ghFetch(`${env.GITHUB_API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (res.status === 401) {
    await res.body?.cancel();
    throw new UserTokenRejected("GitHub rejected the linked account's token");
  }
  return res;
}

/** Whether repository permissions let a user manage a gizlet: admin or maintain. */
const manages = (p: { admin?: boolean; maintain?: boolean } | undefined) => Boolean(p?.admin || p?.maintain);

/** Who a token belongs to now: GitHub's id for the account, which never changes, and its current login, which can. */
export async function githubUser(env: Pick<Env, "GITHUB_API">, token: string): Promise<{ id: number; login: string }> {
  const res = await userFetch(env, token, "/user");
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for the user`);
  }
  const u = (await res.json()) as { id: number; login: string };
  return { id: u.id, login: u.login };
}

/**
 * The repositories a user can see as owner, collaborator or organization member, by canonical key
 * (github.com/<owner>/<name>, lowercase), with GitHub's id and whether they may manage each. Up to 500.
 */
export async function userRepos(env: Pick<Env, "GITHUB_API">, token: string): Promise<Map<string, { id: number; manage: boolean }>> {
  const out = new Map<string, { id: number; manage: boolean }>();
  for (let page = 1; page <= 5; page++) {
    const res = await userFetch(env, token, `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`);
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(`GitHub answered ${res.status} for the user's repositories`);
    }
    const repos = (await res.json()) as { id: number; full_name: string; permissions?: { admin?: boolean; maintain?: boolean } }[];
    for (const r of repos) out.set(`github.com/${r.full_name}`.toLowerCase(), { id: r.id, manage: manages(r.permissions) });
    if (repos.length < 100) break;
  }
  return out;
}

/** The organizations a user belongs to, by login. */
export async function userOrgs(env: Pick<Env, "GITHUB_API">, token: string): Promise<string[]> {
  const res = await userFetch(env, token, "/user/orgs?per_page=100");
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for the user's organizations`);
  }
  return ((await res.json()) as { login: string }[]).map((o) => o.login);
}

/**
 * The repository's GitHub id if the user may manage it now (admin or maintain), asked of GitHub;
 * else null. `id` must be the repository's GitHub id where known: another repository created at
 * the path does not count.
 */
export async function canManage(env: Pick<Env, "GITHUB_API">, token: string, ref: RepoRef, id: number | null): Promise<number | null> {
  const res = await userFetch(env, token, `/repos/${ref.owner}/${ref.name}`);
  if (res.status === 403 || res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(`GitHub answered ${res.status} for ${ref.key}`);
  }
  const r = (await res.json()) as { id: number; permissions?: { admin?: boolean; maintain?: boolean } };
  return (id === null || r.id === id) && manages(r.permissions) ? r.id : null;
}

// --- GitHub App authentication ------------------------------------------------------------------

const appConfigured = (env: Env) => Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_PRIVATE_KEY);

let someInstallation: { id: Promise<number | null>; until: number } | undefined;

/** Any installation of the app: its token reads public repositories at the app's rate limit. */
function anyInstallation(env: Env): Promise<number | null> {
  if (someInstallation && someInstallation.until > Date.now()) return someInstallation.id;
  const id = (async () => {
    const res = await appFetch(env, "/app/installations?per_page=1");
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return ((await res.json()) as { id: number }[])[0]?.id ?? null;
  })().catch(() => null);
  someInstallation = { id, until: Date.now() + INSTALLATION_TTL_MS };
  return id;
}

async function appHeaders(env: Env, installation: number): Promise<Headers> {
  return new Headers({ authorization: `Bearer ${await installationToken(env, installation)}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" });
}

/**
 * GitHub's id for the repository at a path now (following a rename), null when there is none, or
 * undefined when GitHub did not say. Asked with an app installation token where the app is
 * configured, else without credentials.
 */
export async function repositoryIdAt(env: Env, ref: RepoRef): Promise<number | null | undefined> {
  const r = await appGet(env, `/repos/${ref.owner}/${ref.name}`, ref.key);
  return r && r.id;
}

/** Where the repository with a GitHub id is now, null when it is gone, or undefined when GitHub did not say. */
export async function repositoryById(env: Env, id: number): Promise<RepoInfo | null | undefined> {
  const r = await appGet(env, `/repositories/${id}`, String(id));
  return r && { id: r.id, owner: r.owner.login, name: r.name, private: r.private };
}

/** A repository from the API, as the app (or anyone, without the app): null for a 404, undefined when GitHub did not say. */
async function appGet(env: Env, path: string, what: string): Promise<{ id: number; name: string; private: boolean; owner: { login: string } } | null | undefined> {
  try {
    const installation = appConfigured(env) ? await anyInstallation(env) : null;
    const headers = installation === null ? new Headers({ accept: "application/vnd.github+json" }) : await appHeaders(env, installation);
    const res = await ghFetch(`${env.GITHUB_API}${path}`, { headers });
    if (!res.ok) {
      await res.body?.cancel();
      return res.status === 404 ? null : undefined;
    }
    return (await res.json()) as { id: number; name: string; private: boolean; owner: { login: string } };
  } catch (e) {
    console.error("repository lookup failed", what, e);
    return undefined;
  }
}

/**
 * Like canManage, for a repository the app is installed on, asked by the user's GitHub login: users'
 * tokens do not see private repositories (that would take the `repo` scope), the app does.
 */
export async function appCanManage(env: Env, ref: RepoRef, login: string, id: number | null): Promise<number | null> {
  if (!appConfigured(env)) return null;
  try {
    const installation = await installationFor(env, ref);
    if (installation === null) return null;
    const headers = await appHeaders(env, installation);
    const base = `${env.GITHUB_API}/repos/${ref.owner}/${ref.name}`;
    const [repo, perm] = await Promise.all([ghFetch(base, { headers }), ghFetch(`${base}/collaborators/${encodeURIComponent(login)}/permission`, { headers })]);
    if (!repo.ok || !perm.ok) {
      await Promise.all([repo.body?.cancel(), perm.body?.cancel()]);
      return null;
    }
    const r = (await repo.json()) as { id: number };
    const p = (await perm.json()) as { role_name?: string };
    return (p.role_name === "admin" || p.role_name === "maintain") && (id === null || r.id === id) ? r.id : null;
  } catch (e) {
    if (e instanceof TokenDenied || e instanceof UpstreamError) return null;
    throw e;
  }
}

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
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new TokenDenied(`GitHub refused an installation token (${res.status})`);
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

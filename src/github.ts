/**
 * Reading releases from GitHub.
 *
 * Only github.com web URLs are used (no REST API), so indexing needs no GitHub credentials:
 *   github.com/<o>/<r>/releases/latest                    -> 302 to /releases/tag/<tag>
 *   github.com/<o>/<r>/releases/download/<tag>/<asset>    -> a release asset (packages)
 *   raw.githubusercontent.com/<o>/<r>/<tag>/<path>        -> a repository file (gizlet.toml, art)
 */
import type { Env } from "./env";
import type { RepoRef } from "./repo";
import { IndexError, MAX_TOML_BYTES, parseGizletToml, type GizletToml } from "./schema";

export class NotFound extends Error {}
export class UpstreamError extends Error {}

const UA = "gizlet (+https://gizlet.io)";

export function assetUrl(env: Env, owner: string, name: string, tag: string, file: string): string {
  return `${env.GITHUB_WEB}/${owner}/${name}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

/** A repository file at a tag. */
export function rawUrl(env: Env, owner: string, name: string, tag: string, path: string): string {
  return `${env.GITHUB_RAW}/${owner}/${name}/${encodeURIComponent(tag)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", UA);
  return fetch(url, { ...init, headers });
}

/** Tag of the repository's latest release, or null when it has none / does not exist. */
export async function latestTag(env: Env, ref: RepoRef): Promise<string | null> {
  const res = await ghFetch(`${env.GITHUB_WEB}/${ref.owner}/${ref.name}/releases/latest`, { redirect: "manual" });
  await res.body?.cancel();
  if (res.status === 404) return null;
  if (res.status < 300 || res.status >= 400) throw new UpstreamError(`GitHub answered ${res.status} for the latest release`);
  const loc = res.headers.get("location") ?? "";
  const m = /\/releases\/tag\/([^/?#]+)$/.exec(loc);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** The repository's gizlet.toml at a release tag. */
export async function fetchGizletToml(env: Env, ref: RepoRef, tag: string): Promise<GizletToml> {
  const res = await ghFetch(rawUrl(env, ref.owner, ref.name, tag, "gizlet.toml"));
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

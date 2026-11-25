/**
 * Reading releases from GitHub.
 *
 * Only github.com web URLs are used (no REST API), so indexing needs no GitHub credentials:
 *   /<o>/<r>/releases/latest                    -> 302 to /releases/tag/<tag>
 *   /<o>/<r>/releases/download/<tag>/<asset>    -> the asset
 */
import type { Env } from "./env";
import type { RepoRef } from "./repo";
import { IndexError, parseIndex, type ReleaseIndex } from "./schema";

export class NotFound extends Error {}
export class UpstreamError extends Error {}

const UA = "gizlet (+https://gizlet.io)";
const MAX_INDEX_BYTES = 256 * 1024;

export function assetUrl(env: Env, owner: string, name: string, tag: string, file: string): string {
  return `${env.GITHUB_WEB}/${owner}/${name}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
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

export async function fetchIndex(env: Env, ref: RepoRef, tag: string): Promise<ReleaseIndex> {
  const res = await ghFetch(assetUrl(env, ref.owner, ref.name, tag, "gizlet.json"));
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

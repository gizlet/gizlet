/**
 * Store art for handhelds: small PNGs the launcher can decode (its raylib reads PNG, not JPEG or
 * WebP) at the size it draws them. They are made from the release's art when it is mirrored,
 * and on first request for releases mirrored before they existed.
 */
import type { Env } from "./env";
import type { GizletToml } from "./schema";

/** The path segment device art is served under; `~` is never in a repository path. */
export const DEVICE_DIR = "~device";

const SIZES = {
  icon: { width: 128, height: 128 },
  cover: { width: 640, height: 360 },
  screenshot: { width: 640, height: 480 },
} as const;

export interface DeviceArt {
  /** The art it is made from: a repository path gizlet.toml names. */
  source: string;
  width: number;
  height: number;
}

/** Device art of a release by file name: icon.png, cover.png, screenshot-1.png ... */
export function deviceArt(spec: Pick<GizletToml, "icon" | "cover" | "screenshots">): Map<string, DeviceArt> {
  const art = new Map<string, DeviceArt>();
  if (spec.icon) art.set("icon.png", { source: spec.icon, ...SIZES.icon });
  if (spec.cover) art.set("cover.png", { source: spec.cover, ...SIZES.cover });
  spec.screenshots.forEach((source, i) => art.set(`screenshot-${i + 1}.png`, { source, ...SIZES.screenshot }));
  return art;
}

/** R2 key of a device art file; under the tag, so pruning a release removes it too. */
export const deviceArtKey = (repo: string, tag: string, name: string) => `${repo}/${tag}/device/${name}`;

export const deviceArtUrl = (env: Env, repo: string, tag: string, name: string) => `${env.DL_ORIGIN}/${repo}/${encodeURIComponent(tag)}/${DEVICE_DIR}/${name}`;

/** Scale and crop `bytes` to fill the art's size, as PNG; null when it is not an image Images can read. */
export async function renderDeviceArt(env: Env, bytes: Uint8Array | ReadableStream<Uint8Array>, art: DeviceArt): Promise<ArrayBuffer | null> {
  const stream = bytes instanceof ReadableStream ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
  try {
    const out = await env.IMAGES.input(stream)
      .transform({ width: art.width, height: art.height, fit: "cover" })
      .output({ format: "image/png" });
    return await out.response().arrayBuffer();
  } catch (e) {
    console.error("device art failed", art.source, e);
    return null;
  }
}

/** Make and store one device art file; false when its source is not a readable image. */
export async function storeDeviceArt(env: Env, repo: string, tag: string, name: string, art: DeviceArt, bytes: Uint8Array | ReadableStream<Uint8Array>): Promise<boolean> {
  const png = await renderDeviceArt(env, bytes, art);
  if (!png) return false;
  await env.BUCKET.put(deviceArtKey(repo, tag, name), png, { httpMetadata: { contentType: "image/png" } });
  return true;
}

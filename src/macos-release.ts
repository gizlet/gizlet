/**
 * The Gizlet Launcher for macOS (gizlet/macos), published to R2 by its Release workflow:
 * `macos/releases/<tag>/` holds each version's files, its manifest uploaded last, and
 * `macos/latest.json` the newest version's signed manifest, which the Launcher reads
 * every two minutes. The Launcher verifies the signature; the Worker only serves.
 */
import { OS_TAG } from "./os-release";

/** A file in a version folder: one name, no folders. */
export const MACOS_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MACOS_LATEST = "macos/latest.json";

export const macosKey = (tag: string, file: string) => `macos/releases/${tag}/${file}`;

/** The newest version's tag and disk image, from `macos/latest.json`; null without a valid one. */
export async function latestMacosRelease(bucket: R2Bucket): Promise<{ tag: string; dmg: string } | null> {
  const object = await bucket.get(MACOS_LATEST);
  if (!object) return null;
  try {
    const envelope = await object.json<{ manifest?: unknown }>();
    if (typeof envelope.manifest !== "string") return null;
    const manifest = JSON.parse(envelope.manifest) as { tag?: unknown; dmg?: { path?: unknown } };
    const tag = manifest.tag;
    const dmg = manifest.dmg?.path;
    if (typeof tag !== "string" || !OS_TAG.test(tag) || typeof dmg !== "string" || !MACOS_FILE.test(dmg)) return null;
    return { tag, dmg };
  } catch {
    return null;
  }
}

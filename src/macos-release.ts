/**
 * The Gizlet Launcher for macOS (gizlet/macos), published to R2 by its Release workflow:
 * `macos/releases/<tag>/` holds each version's files, its manifest uploaded last, and
 * `macos/latest.json` the newest version's signed manifest, which the Launcher reads
 * every two minutes. The Launcher verifies the signature; the Worker only serves.
 */
import { OS_TAG } from "./os-release.ts";

/** A file in a version folder: one name, no folders. */
export const MACOS_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MACOS_LATEST = "macos/latest.json";

export const macosKey = (tag: string, file: string) => `macos/releases/${tag}/${file}`;

type MacosRelease = { tag: string } & ({ universal: string } | { arm64: string; x86_64: string });

export async function latestMacosRelease(bucket: R2Bucket): Promise<MacosRelease | null> {
  const object = await bucket.get(MACOS_LATEST);
  if (!object) return null;
  try {
    const envelope = await object.json<{ manifest?: unknown }>();
    if (typeof envelope.manifest !== "string") return null;
    const manifest = JSON.parse(envelope.manifest) as {
      tag?: unknown;
      dmg?: { path?: unknown };
      dmgs?: { arm64?: { path?: unknown }; x86_64?: { path?: unknown } };
    };
    const tag = manifest.tag;
    if (typeof tag !== "string" || !OS_TAG.test(tag)) return null;
    if (manifest.dmgs !== undefined) {
      const arm64 = manifest.dmgs?.arm64?.path;
      const x86_64 = manifest.dmgs?.x86_64?.path;
      if (arm64 !== `Gizlet-${tag.slice(1)}-arm64.dmg` || x86_64 !== `Gizlet-${tag.slice(1)}-x86_64.dmg`) return null;
      return { tag, arm64, x86_64 };
    }
    const universal = manifest.dmg?.path;
    if (universal !== `Gizlet-${tag.slice(1)}.dmg`) return null;
    return { tag, universal };
  } catch {
    return null;
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { latestMacosRelease } from "../../src/macos-release.ts";

function bucketWith(manifest: unknown): R2Bucket {
  return { get: async () => ({ json: async () => ({ manifest: JSON.stringify(manifest) }) }) } as unknown as R2Bucket;
}

test("an earlier universal release still serves the same installer for both architectures", async () => {
  const release = await latestMacosRelease(bucketWith({ tag: "v0.1.0", dmg: { path: "Gizlet-0.1.0.dmg" } }));
  assert.deepEqual(release, { tag: "v0.1.0", universal: "Gizlet-0.1.0.dmg" });
});

test("an incomplete or mismatched per-architecture release cannot fall back to one installer's alias", async () => {
  const arm64 = { path: "Gizlet-0.1.1-arm64.dmg" };
  for (const dmgs of [{ arm64 }, { arm64, x86_64: arm64 }, { arm64, x86_64: { path: "Gizlet-0.1.0-x86_64.dmg" } }]) {
    assert.equal(await latestMacosRelease(bucketWith({ tag: "v0.1.1", dmg: arm64, dmgs })), null);
  }
});

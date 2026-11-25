import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions } from "../../src/schema.ts";

test("SemVer precedence", () => {
  // Each version ranks above the one before it (the SemVer 2.0.0 example, plus core cases).
  const ordered = [
    "0.9.9",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0-rc.2",
    "1.0.0-rc.10",
    "1.0.0",
    "1.0.1",
    "1.2.0",
    "1.10.0",
  ];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      assert.equal(compareVersions(ordered[i]!, ordered[j]!), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
    }
  }
});

test("prefixes, build metadata and hyphens in prereleases", () => {
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3+build.5", "1.2.3+build.9"), 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.0.0-rc-2", "1.0.0-rc-10"), 1); // alphanumeric: compared as text
  assert.equal(compareVersions("1.0.0-x-y.1", "1.0.0-x-y"), 1);
});

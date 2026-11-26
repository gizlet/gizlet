import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { pkcs1ToPkcs8 } from "../../src/pem.ts";
import { computeScore, ratingAverage } from "../../src/score.ts";

const base = { ratingCount: 0, ratingSum: 0, downloads: 0, marks: [] as string[], warnings: 0 };

test("score: an unrated, undownloaded gizlet that passed its checks", () => {
  // 20 for ratings at the prior (3 stars), 15 for clean checks.
  assert.equal(computeScore(base), 35);
  assert.equal(computeScore({ ...base, warnings: 2 }), 28);
  assert.equal(computeScore({ ...base, warnings: null }), 20);
});

test("score: marks, downloads and ratings", () => {
  assert.equal(computeScore({ ...base, marks: ["awesome"] }), 45);
  assert.equal(computeScore({ ...base, marks: ["awesome", "scanned"] }), 55);
  assert.equal(computeScore({ ...base, downloads: 9999 }), 60);
  assert.equal(computeScore({ ...base, downloads: 1e9 }), 60);
  // One 5-star vote moves the mean from 3 to (15 + 5) / 6, not to 5.
  assert.equal(computeScore({ ...base, ratingCount: 1, ratingSum: 5 }), 38);
  assert.equal(computeScore({ ratingCount: 1000, ratingSum: 5000, downloads: 1e6, marks: ["awesome", "scanned"], warnings: 0 }), 100);
  assert.equal(computeScore({ ...base, ratingCount: 1000, ratingSum: 1000, warnings: null }), 0);
});

test("rating average", () => {
  assert.equal(ratingAverage(0, 0), null);
  assert.equal(ratingAverage(3, 13), 4.33);
});

test("a PKCS#1 key (as GitHub issues them) becomes the same PKCS#8 key", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "der" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  assert.deepEqual(Buffer.from(pkcs1ToPkcs8(new Uint8Array(pkcs1))), pkcs8);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_LINK_MIN_LENGTH, LINK_MAX, LINK_MIN, linkProblem, minLengthOf, normalizeLinkId, RESERVED, sameGizlet } from "../../src/links.ts";

test("short link ids: lowercase letters, digits and single hyphens, from a letter to a letter or digit", () => {
  for (const ok of ["browser", "rocket-snail", "a1b", "x-1-y", "abc", "a".repeat(LINK_MAX)]) assert.equal(linkProblem(ok), null, ok);
  for (const bad of ["1abc", "-abc", "abc-", "ab--cd", "ab_cd", "ab.cd", "ab cd", "Abc", "über", ""]) assert.equal(linkProblem(bad), "format", bad);
  assert.equal(linkProblem("a".repeat(LINK_MAX + 1)), "too_long");
});

test("ids are compared lowercase", () => {
  assert.equal(normalizeLinkId("  Browser "), "browser");
  assert.equal(linkProblem(normalizeLinkId("Rocket-Snail")), null);
});

test("each account has a minimum length, 6 unless an admin changed it, never under 3", () => {
  assert.equal(DEFAULT_LINK_MIN_LENGTH, 6);
  assert.equal(minLengthOf(null), 6);
  assert.equal(minLengthOf(undefined), 6);
  assert.equal(minLengthOf(3), 3);
  assert.equal(linkProblem("snail", minLengthOf(null)), "too_short");
  assert.equal(linkProblem("snails", minLengthOf(null)), null);
  assert.equal(linkProblem("tea", 3), null);
  // The global minimum holds whatever the account's.
  assert.equal(linkProblem("ab", 1), "too_short");
  assert.equal(LINK_MIN, 3);
});

test("the site's own paths and kept words are reserved", () => {
  for (const id of ["account", "login", "device", "devices", "explore", "install", "flash", "open", "static", "admin", "api", "settings", "store", "gizlet", "help", "about"]) {
    assert.equal(linkProblem(id, 3), "reserved", id);
  }
  assert.ok(RESERVED.has("me") && RESERVED.has("u"));
  // Every single-segment path src/site.ts routes is reserved.
  const site = readFileSync(new URL("../../src/site.ts", import.meta.url), "utf8");
  const routes = [...site.matchAll(/site\.get\("\/([a-z][a-z0-9-]*)[/"]/g)].map((m) => m[1]!);
  assert.ok(routes.length >= 8);
  for (const r of routes) assert.ok(RESERVED.has(r), `${r} is routed but not reserved`);
});

test("a link belongs to a gizlet by GitHub repository id where both know it, else by repository", () => {
  const g = { repo: "github.com/a/b", repository_id: 42 };
  assert.equal(sameGizlet({ repo: "github.com/a/old-name", repository_id: 42 }, g), true);
  assert.equal(sameGizlet({ repo: "github.com/a/b", repository_id: 43 }, g), false);
  assert.equal(sameGizlet({ repo: "github.com/a/b", repository_id: null }, g), true);
  assert.equal(sameGizlet({ repo: "github.com/a/c", repository_id: null }, { repo: "github.com/a/c", repository_id: null }), true);
});

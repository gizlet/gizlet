import assert from "node:assert/strict";
import { test } from "node:test";
import { landingName, manifestKind, manifestMismatches, parseManifest, pathProblem } from "../../src/check.ts";

const expected = { id: "dev.test", name: "Test", version: "1.0.0", kind: "app" as const, runtime: 1, target: "aarch64-unknown-linux-gnu", tier: "lite", entry: "bin/game" };

test("manifest.json: must be a JSON object", () => {
  assert.deepEqual(parseManifest('{"id": "dev.test"}'), { id: "dev.test" });
  assert.throws(() => parseManifest("id = 'dev.test'"), /not valid JSON/);
  assert.throws(() => parseManifest("[1]"), /not a JSON object/);
  assert.throws(() => parseManifest("null"), /not a JSON object/);
});

test("manifest.json: must match gizlet.toml, runtime defaulting to 1", () => {
  const { runtime: _, ...rest } = expected;
  assert.deepEqual(manifestMismatches({ ...rest, color: "#000000" }, expected), []);
  assert.deepEqual(manifestMismatches({ ...expected, tier: "full", entry: "game" }, expected), [
    'manifest.json has tier "full", gizlet.toml says "lite"',
    'manifest.json has entry "game", gizlet.toml says "bin/game"',
  ]);
  assert.deepEqual(manifestMismatches({ ...expected, runtime: "1" }, expected), ['manifest.json has runtime "1", gizlet.toml says 1']);
  assert.equal(manifestMismatches({}, expected).length, 6);
});

test("manifest.json: schema 1 (or none) is an app, schema 2 names its kind", () => {
  assert.equal(manifestKind({}), "app");
  assert.equal(manifestKind({ schema: 1 }), "app");
  assert.equal(manifestKind({ schema: 1, kind: "app" }), "app");
  assert.equal(manifestKind({ schema: 2, kind: "app" }), "app");
  assert.equal(manifestKind({ schema: 2, kind: "service" }), "service");
  assert.deepEqual(manifestKind({ schema: 1, kind: "service" }), { problem: 'manifest.json schema 1 is always an app, but it has kind "service"; use schema 2' });
  assert.deepEqual(manifestKind({ schema: 2 }), { problem: "manifest.json schema 2 must name its kind (app or service)" });
  assert.deepEqual(manifestKind({ schema: 2, kind: "rom" }), { problem: 'manifest.json has kind "rom", not app or service' });
  assert.deepEqual(manifestKind({ schema: 3, kind: "app" }), { problem: "manifest.json has schema 3; only 1 and 2 are supported" });
  assert.deepEqual(manifestKind({ schema: "2", kind: "app" }), { problem: 'manifest.json has schema "2"; only 1 and 2 are supported' });
});

test("manifest.json: its kind must match gizlet.toml", () => {
  const service = { ...expected, kind: "service" as const };
  const { runtime: _, kind: __, ...rest } = expected;
  assert.deepEqual(manifestMismatches({ schema: 2, kind: "service", ...rest }, service), []);
  assert.deepEqual(manifestMismatches({ schema: 2, kind: "app", ...rest }, expected), []);
  assert.deepEqual(manifestMismatches({ schema: 1, ...rest }, service), ['manifest.json is an app, gizlet.toml says kind "service"']);
  assert.deepEqual(manifestMismatches({ schema: 2, kind: "service", ...rest }, expected), ['manifest.json is a service, gizlet.toml says kind "app"']);
  assert.deepEqual(manifestMismatches({ schema: 2, ...rest }, expected), ["manifest.json schema 2 must name its kind (app or service)"]);
});

test("zip paths must be canonical", () => {
  for (const ok of ["game", "assets/", "assets/level.txt", "a/b/c.png", ".hidden", "a..b"]) assert.equal(pathProblem(ok), null, ok);
  for (const bad of ["", "./game", "a/./b", "a//b", "/etc/passwd", "a/../b", "..", "a\\b", "C:/x", "a\nb", "assets//"]) assert.notEqual(pathProblem(bad), null, JSON.stringify(bad));
});

test("names that extract to the same place collide", () => {
  assert.equal(landingName("game"), landingName("Game"));
  assert.equal(landingName("assets/"), landingName("assets"));
  assert.equal(landingName("caf\u00e9"), landingName("cafe\u0301"));
  assert.notEqual(landingName("game"), landingName("game2"));
});

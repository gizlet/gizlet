import assert from "node:assert/strict";
import { test } from "node:test";
import { landingName, manifestFields, pathProblem } from "../../src/check.ts";

test("manifest.toml: basic and literal strings, tables ignored", () => {
  const m = manifestFields(["id = 'dev.test'", 'version = "1.0.0"', "target = 'aarch64-unknown-linux-gnu' # comment", "entry = \"bin/game\"", "", "[names]", '"zh-CN" = "游戏"'].join("\n"));
  assert.deepEqual(m, { id: "dev.test", version: "1.0.0", target: "aarch64-unknown-linux-gnu", entry: "bin/game" });
});

test("manifest.toml: non-string values are left out, invalid TOML throws", () => {
  assert.deepEqual(manifestFields("id = 3\nentry = 'game'"), { entry: "game" });
  assert.throws(() => manifestFields("id = 'unterminated"), /not valid TOML/);
  assert.throws(() => manifestFields("id = 'a'\nid = 'b'"), /not valid TOML/);
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

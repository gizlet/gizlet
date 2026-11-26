import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compareVersions, parseGizletToml } from "../../src/schema.ts";

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

const FIXTURE = new URL("../fixtures/repos/rocket-snail/gizlet.toml", import.meta.url);
const minimal = ['id = "dev.test.game"', 'name = "Game"', 'version = "1.0.0"', "", "[[packages]]", 'target = "aarch64-unknown-linux-gnu"', 'tier = "lite"', 'entry = "bin/game"'].join("\n");

test("gizlet.toml: the Rocket Snail fixture", () => {
  const g = parseGizletToml(readFileSync(FIXTURE, "utf8"));
  assert.equal(g.id, "io.gizlet.rocket-snail");
  assert.equal(g.names["zh-CN"], "火箭蜗牛");
  assert.equal(g.category, "game");
  assert.equal(g.runtime, 1);
  assert.equal(g.cover, "store/cover.jpg");
  assert.equal(g.pattern, "store/pattern.png");
  assert.equal(g.screenshots.length, 4);
  assert.equal(g.about["zh-CN"], "store/about.zh-CN.md");
  assert.deepEqual(g.controls[1], { button: "a", action: "Fire the rocket", actions: { "zh-CN": "点火加速", "zh-TW": "點火加速", ja: "ロケット点火" } });
  assert.deepEqual(g.packages[0], { target: "aarch64-unknown-linux-gnu", tier: "lite", entry: "bin/rocket-snail", file: "io.gizlet.rocket-snail-0.1.0-aarch64-unknown-linux-gnu-lite.gzl" });
});

test("gizlet.toml: defaults", () => {
  const g = parseGizletToml(minimal);
  assert.equal(g.category, "app");
  assert.equal(g.runtime, 1);
  assert.equal(g.icon, null);
  assert.deepEqual(g.screenshots, []);
  assert.equal(g.packages[0]!.file, "dev.test.game-1.0.0-aarch64-unknown-linux-gnu-lite.gzl");
});

test("gizlet.toml: mistakes are refused", () => {
  const bad = (extra: string, pattern: RegExp) => assert.throws(() => parseGizletToml(`${extra}\n${minimal}`), pattern, extra);
  bad('kind = "game"', /kind is not a gizlet.toml field/);
  bad('icon = "/etc/icon.png"', /not a canonical repository path/);
  bad('icon = "store/../icon.png"', /not a canonical repository path/);
  bad('cover = "store/cover.gif"', /cover must be a .png, .jpg or .webp file/);
  bad('pattern = "store/tile.svg"', /pattern must be a .png, .jpg or .webp file/);
  bad("runtime = 2", /runtime must be one of 1/);
  bad('color = "red"', /color must be #RRGGBB/);
  bad('category = "tool"', /category must be game or app/);
  assert.throws(() => parseGizletToml(minimal.replace('id = "dev.test.game"', 'id = "Game"')), /reverse-DNS/);
  assert.throws(() => parseGizletToml(minimal.replace('entry = "bin/game"', 'entry = "../game"')), /canonical path inside the package/);
  assert.throws(() => parseGizletToml(`${minimal}\nexec = "game"`), /packages\[0\]\.exec is not a gizlet.toml field/);
  assert.throws(() => parseGizletToml(`${minimal}\n\n[[packages]]\ntarget = "aarch64-unknown-linux-gnu"\ntier = "lite"\nentry = "x"`), /listed twice/);
  assert.throws(() => parseGizletToml(minimal.split("\n").slice(0, 3).join("\n")), /at least one package/);
  assert.throws(() => parseGizletToml("id = "), /not valid TOML/);
});

test("gizlet.toml: links", () => {
  const g = parseGizletToml(readFileSync(FIXTURE, "utf8"));
  // In the store's order, whatever order gizlet.toml gives.
  assert.deepEqual(Object.keys(g.links), ["website", "x", "discord", "bilibili"]);
  assert.equal(g.links.x, "https://x.com/gizletio");
  const links = (body: string) => parseGizletToml(`${minimal}\n\n[links]\n${body}`).links;
  assert.deepEqual(links('mastodon = "https://mastodon.social/@me"\nyoutube = "https://www.youtube.com/@me"'), { mastodon: "https://mastodon.social/@me", youtube: "https://www.youtube.com/@me" });
  assert.throws(() => links('discord = "https://discord.evil.test/x"'), /links.discord must be a link to discord.gg or discord.com/);
  assert.throws(() => links('x = "https://notx.com/me"'), /links.x must be a link to x.com/);
  assert.throws(() => links('website = "http://me.test"'), /https:\/\/ URL/);
  assert.throws(() => links('website = "javascript:alert(1)"'), /https:\/\/ URL/);
  assert.throws(() => links('website = "https://user:pw@me.test"'), /https:\/\/ URL/);
  assert.throws(() => links('facebook = "https://facebook.com/me"'), /links.facebook is not a gizlet.toml field/);
});

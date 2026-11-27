import assert from "node:assert/strict";
import test from "node:test";
import { parseFeaturedConfig } from "../../src/featured-config.ts";

const picks = { id: "picks", title: "Picks", repos: ["Gizlet/Browser", "https://github.com/gizlet/browser", "gizlet/little-prince"] };

test("featured configuration keeps order and normalizes repository keys", () => {
  assert.deepEqual(parseFeaturedConfig(), []);
  assert.deepEqual(parseFeaturedConfig("[]"), []);
  const [collection] = parseFeaturedConfig(JSON.stringify([picks]));
  assert.deepEqual(collection?.repos, ["github.com/gizlet/browser", "github.com/gizlet/little-prince"]);
  assert.equal(collection?.layout, "row");
});

test("featured configuration rejects invalid JSON and conflicting collections", () => {
  assert.throws(() => parseFeaturedConfig("{"), /not valid JSON/);
  assert.throws(() => parseFeaturedConfig(JSON.stringify([{ ...picks, titles: { en: 1 } }])), /titles/);
  assert.throws(() => parseFeaturedConfig(JSON.stringify([{ ...picks, id: "new" }])), /reserved id/);
  assert.throws(() => parseFeaturedConfig(JSON.stringify([picks, picks])), /duplicate/);
  assert.throws(() => parseFeaturedConfig(JSON.stringify([{ ...picks, layout: "hero" }, { ...picks, id: "other", layout: "hero" }])), /only one hero/);
  assert.throws(() => parseFeaturedConfig(JSON.stringify([{ ...picks, title: "精".repeat(1800) }])), /5 KB/);
});

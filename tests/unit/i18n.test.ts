import assert from "node:assert/strict";
import { test } from "node:test";
import { localized, matchLocale, MESSAGES, negotiate, LOCALES } from "../../src/i18n.ts";

test("language tags map onto the site's locales", () => {
  assert.equal(matchLocale("zh"), "zh-CN");
  assert.equal(matchLocale("zh-Hant"), "zh-TW");
  assert.equal(matchLocale("zh-HK"), "zh-TW");
  assert.equal(matchLocale("zh-Hans-HK"), "zh-CN");
  assert.equal(matchLocale("ja-JP"), "ja");
  assert.equal(matchLocale("EN-gb"), "en");
  assert.equal(matchLocale("fr"), null);
});

test("Accept-Language: highest q first, unsupported tags skipped", () => {
  assert.equal(negotiate(undefined), "en");
  assert.equal(negotiate("fr, ja;q=0.9, zh-CN;q=0.95"), "zh-CN");
  assert.equal(negotiate("de-DE, zh-TW;q=0.4"), "zh-TW");
  assert.equal(negotiate("ja;q=0, en;q=0.1"), "en");
  assert.equal(negotiate("ko"), "en");
});

test("a gizlet's own names: the locale's tags, then the default", () => {
  const names = { "zh-Hans": "简", "ZH-tw": "繁", ja: "日" };
  assert.equal(localized(names, "Def", "zh-CN"), "简");
  assert.equal(localized(names, "Def", "zh-TW"), "繁");
  assert.equal(localized(names, "Def", "ja"), "日");
  assert.equal(localized(names, "Def", "en"), "Def");
  assert.equal(localized({ "zh-CN": "简" }, "Def", "zh-TW"), "Def");
});

test("every locale has every string the English one has", () => {
  const shape = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v;
  for (const l of LOCALES) assert.deepEqual(shape(MESSAGES[l]), shape(MESSAGES.en), l);
});

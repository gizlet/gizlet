import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  adoptRepositoryId,
  bindLinks,
  claimLink,
  currentLink,
  DEFAULT_LINK_MIN_LENGTH,
  gizletKey,
  LINK_MAX,
  LINK_MIN,
  linkProblem,
  minLengthOf,
  normalizeLinkId,
  releaseLink,
  RESERVED,
  resolveLink,
  sameGizlet,
} from "../../src/links.ts";

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
  assert.equal(gizletKey(g), "id:42");
  assert.equal(gizletKey({ repo: "github.com/a/c", repository_id: null }), "repo:github.com/a/c");
  assert.equal(sameGizlet({ gizlet: "id:42" }, { repo: "github.com/a/renamed", repository_id: 42 }), true);
  assert.equal(sameGizlet({ gizlet: "id:43" }, g), false);
  // Set before GitHub's id was known.
  assert.equal(sameGizlet({ gizlet: "repo:github.com/a/b" }, g), true);
  assert.equal(sameGizlet({ gizlet: "repo:github.com/a/c" }, { repo: "github.com/a/c", repository_id: null }), true);
});

// --- Claims against SQLite, as D1 runs them ---------------------------------------------------------

/** D1 on an in-memory SQLite: each call awaits first, so concurrent callers interleave; a batch is one transaction. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../migrations/d1/0006_links.sql", import.meta.url), "utf8"));
  db.exec("CREATE TABLE gizlets (repo TEXT PRIMARY KEY, repository_id INTEGER, visibility TEXT NOT NULL DEFAULT 'listed', updated_at INTEGER NOT NULL DEFAULT 0)");
  db.exec("CREATE TABLE releases (repo TEXT NOT NULL, tag TEXT NOT NULL, repository_id INTEGER, PRIMARY KEY (repo, tag))");
  const tick = () => new Promise((r) => setImmediate(r));
  type Arg = string | number | null;
  const stmt = (sql: string, args: Arg[] = []) => ({
    sql,
    args,
    bind: (...a: Arg[]) => stmt(sql, a),
    first: async () => (await tick(), db.prepare(sql).get(...args) ?? null),
    all: async () => (await tick(), { results: db.prepare(sql).all(...args) }),
    run: async () => (await tick(), { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  const DB = {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: ReturnType<typeof stmt>[]) => {
      await tick();
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, env: { DB } as never };
}

const a = { repo: "github.com/o/a", repository_id: 1 };
const b = { repo: "github.com/o/b", repository_id: 2 };

test("two gizlets claiming one id at once: one wins, the other is told it is taken", async () => {
  const { db, env } = d1();
  const results = await Promise.all([claimLink(env, a, "shared", "u1"), claimLink(env, b, "shared", "u2")]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  const winner = results[0]!.ok ? a : b;
  assert.deepEqual({ ...db.prepare("SELECT gizlet, expires_at FROM links WHERE id = 'shared'").get() }, { gizlet: gizletKey(winner), expires_at: null });
});

test("one gizlet claiming two ids at once keeps one current id; the other is held for it", async () => {
  const { db, env } = d1();
  const results = await Promise.all([claimLink(env, a, "first", "u1"), claimLink(env, a, "second", "u1")]);
  assert.ok(results.every((r) => r.ok));
  const rows = db.prepare("SELECT id, expires_at FROM links ORDER BY id").all() as { id: string; expires_at: number | null }[];
  assert.equal(rows.filter((r) => r.expires_at === null).length, 1);
  assert.equal(rows.length, 2);
  // The held one is still this gizlet's: nobody else can take it, and it can be taken back.
  const held = rows.find((r) => r.expires_at !== null)!.id;
  assert.deepEqual(await claimLink(env, b, held, "u2"), { ok: false, code: "taken" });
  assert.deepEqual(await claimLink(env, a, held, "u1"), { ok: true, id: held });
  assert.equal(await currentLink(env, a), held);
});

test("a lapsed id is free again, and an admin moves a live one", async () => {
  const { db, env } = d1();
  await claimLink(env, a, "old-one", "u1");
  await releaseLink(env, a);
  assert.deepEqual(await claimLink(env, b, "old-one", "u2"), { ok: false, code: "taken" });
  db.exec("UPDATE links SET expires_at = 1 WHERE id = 'old-one'");
  assert.deepEqual(await claimLink(env, b, "old-one", "u2"), { ok: true, id: "old-one" });
  assert.deepEqual(await claimLink(env, a, "old-one", null, true), { ok: true, id: "old-one" });
  assert.equal(await currentLink(env, a), "old-one");
  assert.equal(await currentLink(env, b), null);
});

test("a link follows its repository's id, never another repository created at its path", async () => {
  const { db, env } = d1();
  db.exec("INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/a', 1)");
  await claimLink(env, a, "follow-me", "u1");
  assert.equal((await resolveLink(env, "follow-me"))?.gizlet.repo, "github.com/o/a");
  // Renamed: found by its id under the new name.
  db.exec("UPDATE gizlets SET repo = 'github.com/o/renamed'");
  assert.equal((await resolveLink(env, "follow-me"))?.gizlet.repo, "github.com/o/renamed");
  // Deleted, and another repository created at the old path: the link leads nowhere.
  db.exec("DELETE FROM gizlets; INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/a', 99)");
  assert.equal(await resolveLink(env, "follow-me"), null);
});

test("a gizlet indexed without GitHub's id takes the one GitHub confirms, and so do its links", async () => {
  const { db, env } = d1();
  db.exec("INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/web', NULL)");
  db.exec("INSERT INTO releases (repo, tag, repository_id) VALUES ('github.com/o/web', 'v1.0.0', NULL), ('github.com/o/other', 'v1.0.0', NULL)");
  const web = { repo: "github.com/o/web", repository_id: null };
  await claimLink(env, web, "early-one", "u1");
  assert.equal(db.prepare("SELECT gizlet FROM links WHERE id = 'early-one'").get()!.gizlet, "repo:github.com/o/web");
  // Setting a link again: the permission check returned GitHub's id 7.
  const bound = await adoptRepositoryId(env, web, 7);
  assert.equal(bound.repository_id, 7);
  assert.equal(db.prepare("SELECT repository_id FROM gizlets").get()!.repository_id, 7);
  // Its releases indexed while the id was unknown are not taken for that repository's: the path
  // may have changed hands since. They are indexed again under the id (src/api.ts, src/registry.ts).
  assert.deepEqual(
    db.prepare("SELECT repo, repository_id FROM releases ORDER BY repo").all().map((r) => ({ ...r })),
    [
      { repo: "github.com/o/other", repository_id: null },
      { repo: "github.com/o/web", repository_id: null },
    ],
  );
  assert.deepEqual(await claimLink(env, bound, "later-one", "u1"), { ok: true, id: "later-one" });
  assert.deepEqual(
    db.prepare("SELECT id, gizlet FROM links ORDER BY id").all().map((r) => ({ ...r })),
    [
      { id: "early-one", gizlet: "id:7" },
      { id: "later-one", gizlet: "id:7" },
    ],
  );
  // The repository is deleted and another is indexed at its path: neither link leads there.
  db.exec("DELETE FROM gizlets; INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/web', NULL)");
  assert.equal(await resolveLink(env, "later-one"), null);
  assert.equal(await resolveLink(env, "early-one"), null);
});

test("adopting an id that already has a current link keeps one current link, holding the path's", async () => {
  const { db, env } = d1();
  // Linked under its old name, then indexed from the web under its new one and linked there too.
  await claimLink(env, { repo: "github.com/o/old", repository_id: 7 }, "by-id", "u1");
  const renamed = { repo: "github.com/o/new", repository_id: null };
  db.exec("INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/new', NULL)");
  await claimLink(env, renamed, "by-path", "u1");
  const bound = await adoptRepositoryId(env, renamed, 7);
  const rows = db.prepare("SELECT id, gizlet, expires_at FROM links ORDER BY id").all() as { id: string; gizlet: string; expires_at: number | null }[];
  assert.deepEqual(
    rows.map((r) => [r.id, r.gizlet, r.expires_at === null]),
    [
      ["by-id", "id:7", true],
      ["by-path", "id:7", false],
    ],
  );
  assert.equal(await currentLink(env, bound), "by-id");
  // Both still lead to the repository, under its new name.
  assert.equal((await resolveLink(env, "by-path"))?.gizlet.repo, "github.com/o/new");
});

test("links set before the id was known move onto it when indexing learns it", async () => {
  const { db, env } = d1();
  db.exec("INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/web', NULL)");
  await claimLink(env, { repo: "github.com/o/web", repository_id: null }, "set-by-admin", null, true);
  // What src/registry.ts indexRelease batches with the row update when a publish brings the id.
  db.exec("UPDATE gizlets SET repository_id = 9");
  await (env as { DB: { batch: (s: unknown[]) => Promise<unknown> } }).DB.batch(bindLinks(env, "github.com/o/web", 9));
  assert.equal(db.prepare("SELECT gizlet FROM links WHERE id = 'set-by-admin'").get()!.gizlet, "id:9");
  // Another repository at the path later is not its target.
  db.exec("DELETE FROM gizlets; INSERT INTO gizlets (repo, repository_id) VALUES ('github.com/o/web', 10)");
  assert.equal(await resolveLink(env, "set-by-admin"), null);
});

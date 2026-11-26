import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "../../src/env.ts";
import { deletePrefix, pruneRevisions } from "../../src/r2.ts";

/** Just enough of an R2 bucket for list (with a delimiter, paged) and delete. */
function bucket(keys: string[], pageSize = 2) {
  const store = new Set(keys);
  return {
    store,
    async list({ prefix = "", delimiter, cursor }: { prefix?: string; delimiter?: string; cursor?: string }) {
      const under = [...store].filter((k) => k.startsWith(prefix)).sort();
      const entries = delimiter
        ? [...new Set(under.map((k) => (k.indexOf(delimiter, prefix.length) >= 0 ? k.slice(0, k.indexOf(delimiter, prefix.length) + 1) : k)))]
        : under;
      const from = Number(cursor ?? 0);
      const page = entries.slice(from, from + pageSize);
      return {
        objects: page.filter((k) => store.has(k)).map((key) => ({ key })),
        delimitedPrefixes: page.filter((k) => !store.has(k)),
        truncated: from + pageSize < entries.length,
        cursor: String(from + pageSize),
      };
    },
    async delete(k: string | string[]) {
      for (const key of [k].flat()) store.delete(key);
    },
  };
}

test("superseded revisions' package objects are deleted, newer ones and other tags kept", async () => {
  const root = "github.com/o/r/v1.0.0/packages/";
  const b = bucket([
    `${root}r1/a1/x.gzl`,
    `${root}r1/a2/x.gzl`,
    `${root}r2/b1/x.gzl`,
    `${root}r10/c1/x.gzl`,
    `${root}r3/d1/x.gzl`,
    `${root}r4/e1/x.gzl`,
    "github.com/o/r/v1.0.0/repo/store/icon.png",
    "github.com/o/r/v0.9.0/packages/r1/z/x.gzl",
  ]);
  await pruneRevisions({ BUCKET: b } as unknown as Env, "github.com/o/r", "v1.0.0", 4);
  assert.deepEqual([...b.store].sort(), [
    "github.com/o/r/v0.9.0/packages/r1/z/x.gzl",
    `${root}r10/c1/x.gzl`,
    `${root}r4/e1/x.gzl`,
    "github.com/o/r/v1.0.0/repo/store/icon.png",
  ]);
});

test("a prefix is deleted whole, however many pages it spans", async () => {
  const keys = Array.from({ length: 9 }, (_, i) => `github.com/o/r/v1/packages/r1/k${i}`);
  const b = bucket([...keys, "github.com/o/r/v2/repo/icon.png"]);
  await deletePrefix({ BUCKET: b } as unknown as Env, "github.com/o/r/v1/");
  assert.deepEqual([...b.store], ["github.com/o/r/v2/repo/icon.png"]);
});

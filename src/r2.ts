/** Where mirrored files live in R2, and deleting them. Kept free of other modules for the unit tests. */
import type { Env } from "./env";

/** R2 key of store art (icon, cover, pattern, screenshots, about pages): its repository path. */
export function artKey(repo: string, tag: string, path: string): string {
  return `${repo}/${tag}/repo/${path}`;
}

/** Where a tag's packages live in R2, one folder per release revision. */
export const packagesRoot = (repo: string, tag: string) => `${repo}/${tag}/packages/`;
export const packagesPrefix = (repo: string, tag: string, revision: number) => `${packagesRoot(repo, tag)}r${revision}/`;

/**
 * A fresh R2 key for one mirror attempt of a package. Nothing ever overwrites it, so the sha256
 * recorded with it (`packages.object`) always describes its bytes, even when two deliveries of a
 * job mirror the same package at once.
 */
export function newPackageKey(repo: string, tag: string, revision: number, file: string): string {
  return `${packagesPrefix(repo, tag, revision)}${crypto.randomUUID()}/${file}`;
}

export async function deletePrefix(env: Env, prefix: string): Promise<void> {
  // Each pass deletes the first page; what follows moves up, so list from the start again.
  for (;;) {
    const list = await env.BUCKET.list({ prefix });
    if (!list.objects.length) return;
    await env.BUCKET.delete(list.objects.map((o) => o.key));
    if (!list.truncated) return;
  }
}

/**
 * Delete the package objects of a tag's revisions older than `revision`: each publish indexes the
 * tag again, and only the newest revision's packages are ever served. A job of an older revision
 * still running when this runs finds itself superseded and deletes what it wrote after
 * (`mirrorRelease`).
 */
export async function pruneRevisions(env: Env, repo: string, tag: string, revision: number): Promise<void> {
  const root = packagesRoot(repo, tag);
  // List them all first: deleting while paging through a listing would skip some.
  const old: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.BUCKET.list({ prefix: root, delimiter: "/", cursor });
    for (const prefix of list.delimitedPrefixes) {
      const n = Number(/^r(\d+)\/$/.exec(prefix.slice(root.length))?.[1]);
      if (Number.isSafeInteger(n) && n < revision) old.push(prefix);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  for (const prefix of old) await deletePrefix(env, prefix);
}

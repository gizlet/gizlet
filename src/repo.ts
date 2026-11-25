/** A GitHub repository, which is the identity of a gizlet. */
export interface RepoRef {
  owner: string;
  name: string;
  /** Canonical key: github.com/<owner>/<name>, lowercase. */
  key: string;
}

// GitHub: owner up to 39 chars of [A-Za-z0-9-]; repo names [A-Za-z0-9._-], not "." or "..".
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function repoRef(owner: string, name: string): RepoRef | null {
  const n = name.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(n) || n === "." || n === "..") return null;
  return { owner, name: n, key: `github.com/${owner}/${n}`.toLowerCase() };
}

/**
 * Parse any common way of writing a GitHub repository:
 * `github.com/o/r`, `https://github.com/o/r/...`, `git@github.com:o/r.git`, `o/r`,
 * and store or download URLs on gizlet.io.
 */
export function parseRepoAddress(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git\+/, "");
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/#?]+)/i.exec(s);
  if (ssh) return repoRef(ssh[1]!, ssh[2]!);
  s = s.replace(/^[a-z]+:\/\//i, "");
  s = s.replace(/^(?:www\.|store\.|dl\.|api\.)?gizlet\.io\/(?:v1\/gizlets\/)?/i, "");
  s = s.replace(/^www\./i, "");
  const parts = s.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "github.com") parts.shift();
  else if (parts.length !== 2 || parts[0]!.includes(".")) return null;
  if (parts.length < 2) return null;
  return repoRef(parts[0]!, parts[1]!);
}

export function storeUrl(origin: string, r: { key: string } | string): string {
  return `${origin}/${typeof r === "string" ? r : r.key}`;
}

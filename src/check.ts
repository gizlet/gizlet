/**
 * Static checks of a mirrored `.gzl` package (a zip with `manifest.toml`), read from R2 with
 * range requests so a package is never loaded whole. Errors fail the release: it is not
 * served, not even by link. Warnings keep the gizlet out of search and featured lists.
 */
import type { Env } from "./env";

export interface Findings {
  errors: string[];
  warnings: string[];
}

export interface Expected {
  id: string;
  version: string;
  target: string;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 20_000;
const MAX_UNPACKED = 4 * 1024 ** 3;
const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const SPECIAL = new Map([
  [0o020000, "a character device"],
  [0o060000, "a block device"],
  [0o010000, "a FIFO"],
  [0o140000, "a socket"],
]);

/** ELF e_machine per target architecture. */
const ELF_MACHINE: Record<string, number> = {
  aarch64: 183,
  x86_64: 62,
  i686: 3,
  i586: 3,
  arm: 40,
  armv7: 40,
  riscv64: 243,
  riscv64gc: 243,
  loongarch64: 258,
};

interface Entry {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  /** Unix mode when the archive was written on Unix. */
  mode: number | null;
}

class Bad extends Error {}

async function range(env: Env, key: string, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array();
  const obj = await env.BUCKET.get(key, { range: { offset, length } });
  if (!obj) throw new Error(`${key} is not in R2`);
  return new Uint8Array(await obj.arrayBuffer());
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

async function readDirectory(env: Env, key: string, size: number): Promise<Entry[]> {
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = await range(env, key, size - tailLength, tailLength);
  const t = view(tail);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (t.getUint32(i, true) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Bad("is not a zip archive");
  const count = t.getUint16(at + 10, true);
  const dirSize = t.getUint32(at + 12, true);
  const dirOffset = t.getUint32(at + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new Bad("uses ZIP64, which is not supported");
  if (count > MAX_ENTRIES) throw new Bad(`has more than ${MAX_ENTRIES} files`);
  if (dirSize > MAX_DIRECTORY_BYTES || dirOffset + dirSize > size) throw new Bad("has a damaged central directory");
  const dir = await range(env, key, dirOffset, dirSize);
  const d = view(dir);
  const entries: Entry[] = [];
  let p = 0;
  while (p + 46 <= dir.length && d.getUint32(p, true) === CENTRAL) {
    const madeBy = d.getUint16(p + 4, true);
    const nameLength = d.getUint16(p + 28, true);
    const extraLength = d.getUint16(p + 30, true);
    const commentLength = d.getUint16(p + 32, true);
    const external = d.getUint32(p + 38, true);
    if (p + 46 + nameLength > dir.length) break;
    entries.push({
      name: new TextDecoder().decode(dir.subarray(p + 46, p + 46 + nameLength)),
      flags: d.getUint16(p + 8, true),
      method: d.getUint16(p + 10, true),
      compressed: d.getUint32(p + 20, true),
      size: d.getUint32(p + 24, true),
      offset: d.getUint32(p + 42, true),
      mode: madeBy >> 8 === 3 ? external >>> 16 : null,
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length !== count) throw new Bad("has a damaged central directory");
  return entries;
}

async function inflateHead(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (e) {
    // The input may be cut short on purpose: what came out before that is enough.
    if (total === 0) throw new Bad(`has a file that does not decompress: ${String(e)}`);
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.length;
    if (off >= out.length) break;
  }
  return out;
}

/** The first `max` bytes of an entry's contents. */
async function readHead(env: Env, key: string, e: Entry, max: number): Promise<Uint8Array> {
  const local = await range(env, key, e.offset, 30);
  const l = view(local);
  if (local.length < 30 || l.getUint32(0, true) !== LOCAL) throw new Bad(`has a damaged entry for ${e.name}`);
  const start = e.offset + 30 + l.getUint16(26, true) + l.getUint16(28, true);
  if (e.method === 0) return range(env, key, start, Math.min(max, e.compressed));
  // Deflate rarely expands data by more than a few bytes per 16 KiB, and never shrinks it below 1/1032.
  return inflateHead(await range(env, key, start, Math.min(e.compressed, Math.max(max * 2, 256 * 1024))), max);
}

/** Top-level `key = "string"` pairs of a TOML document (TOML basic strings use JSON's escapes). */
export function manifestFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    try {
      out[m[1]!] = JSON.parse(m[2]!) as string;
    } catch {
      // Not a basic string; ignore.
    }
  }
  return out;
}

function unsafePath(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0") || /^[A-Za-z]:/.test(name)) return true;
  return name.split("/").some((s) => s === "..");
}

function executableProblem(target: string, head: Uint8Array): string | null {
  const [arch = ""] = target.split("-");
  if (target.includes("-linux")) {
    if (head.length < 20 || head[0] !== 0x7f || head[1] !== 0x45 || head[2] !== 0x4c || head[3] !== 0x46) return "is not an ELF executable";
    const machine = head[5] === 2 ? (head[18]! << 8) | head[19]! : head[18]! | (head[19]! << 8);
    const want = ELF_MACHINE[arch];
    if (want !== undefined && machine !== want) return `is built for ELF machine ${machine}, not ${arch}`;
    return null;
  }
  if (target.includes("-apple-")) {
    const magic = head.length >= 4 ? view(head).getUint32(0, false) : 0;
    if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return "is not a Mach-O executable";
    return null;
  }
  if (target.includes("-windows")) {
    if (head[0] !== 0x4d || head[1] !== 0x5a) return "is not a Windows executable";
  }
  return null;
}

/** Check one mirrored package. Findings name the package file. */
export async function checkPackage(env: Env, key: string, file: string, size: number, expected: Expected): Promise<Findings> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string) => errors.push(`${file} ${msg}`);
  let entries: Entry[];
  try {
    entries = await readDirectory(env, key, size);
  } catch (e) {
    if (e instanceof Bad) return { errors: [`${file} ${e.message}`], warnings };
    throw e;
  }
  const names = new Map<string, Entry>();
  let unpacked = 0;
  for (const e of entries) {
    if (unsafePath(e.name)) fail(`has an unsafe path ${JSON.stringify(e.name.slice(0, 120))}`);
    if (names.has(e.name)) fail(`lists ${JSON.stringify(e.name.slice(0, 120))} twice`);
    names.set(e.name, e);
    if (e.flags & 1) fail(`has an encrypted file ${JSON.stringify(e.name.slice(0, 120))}`);
    if (e.method !== 0 && e.method !== 8) fail(`uses compression method ${e.method} for ${JSON.stringify(e.name.slice(0, 120))}; only stored and deflate are allowed`);
    if (e.size === 0xffffffff || e.compressed === 0xffffffff) fail("uses ZIP64, which is not supported");
    unpacked += e.size;
    if (e.mode !== null) {
      const type = e.mode & S_IFMT;
      if (type === S_IFLNK) fail(`has a symbolic link ${JSON.stringify(e.name.slice(0, 120))}`);
      const special = SPECIAL.get(type);
      if (special) fail(`has ${special} ${JSON.stringify(e.name.slice(0, 120))}`);
      if (e.mode & 0o6000) fail(`has a setuid or setgid file ${JSON.stringify(e.name.slice(0, 120))}`);
    }
  }
  if (unpacked > MAX_UNPACKED) fail("unpacks to more than 4 GiB");
  if (errors.length) return { errors, warnings };

  const manifestEntry = names.get("manifest.toml");
  if (!manifestEntry) return { errors: [`${file} has no manifest.toml`], warnings };
  if (manifestEntry.size > MAX_MANIFEST_BYTES) return { errors: [`${file} has a manifest.toml larger than 64 KiB`], warnings };
  let manifest: Record<string, string>;
  try {
    manifest = manifestFields(new TextDecoder().decode(await readHead(env, key, manifestEntry, MAX_MANIFEST_BYTES)));
  } catch (e) {
    if (e instanceof Bad) return { errors: [`${file} ${e.message}`], warnings };
    throw e;
  }
  for (const k of ["id", "version", "target"] as const) {
    if (manifest[k] !== expected[k]) fail(`manifest.toml has ${k} ${JSON.stringify(manifest[k] ?? null)}, gizlet.json says ${JSON.stringify(expected[k])}`);
  }
  const entry = manifest.entry;
  const exe = entry ? names.get(entry) : undefined;
  if (!entry) fail("manifest.toml names no entry");
  else if (!exe) fail(`has no entry file ${JSON.stringify(entry.slice(0, 120))}`);
  else {
    try {
      const problem = executableProblem(expected.target, await readHead(env, key, exe, 64));
      if (problem) fail(`entry ${JSON.stringify(entry.slice(0, 120))} ${problem}`);
    } catch (e) {
      if (e instanceof Bad) fail(e.message);
      else throw e;
    }
    if (exe.mode !== null && !(exe.mode & 0o111)) warnings.push(`${file} entry ${JSON.stringify(entry.slice(0, 120))} is not executable`);
  }
  return { errors, warnings };
}

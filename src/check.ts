/**
 * Static checks of a mirrored `.gzl` package (a zip with `manifest.json`), read from R2 with
 * range requests so a package is never loaded whole. Errors fail the release: it is not
 * served, not even by link. Warnings keep the gizlet out of search and featured lists.
 */
import type { Env } from "./env";
import type { Kind } from "./schema";

export interface Findings {
  errors: string[];
  warnings: string[];
}

/** What gizlet.toml says the package's manifest.json holds. */
export interface Expected {
  id: string;
  name: string;
  version: string;
  kind: Kind;
  runtime: number;
  target: string;
  tier: string;
  entry: string;
}
const EXPECTED_KEYS = ["id", "name", "version", "runtime", "target", "tier", "entry"] as const;

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
  /** The name exactly as stored in the central directory. */
  raw: Uint8Array;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  /** Unix mode when the archive was written on Unix. */
  mode: number | null;
}

class Bad extends Error {}

/** Extra fields that give an entry a different name (Info-ZIP Unicode Path). */
const NAME_OVERRIDES = new Set([0x7075]);
const UTF8_FLAG = 1 << 11;
/** Local headers are read in windows of this size, at most MAX_LOCAL_READS of them. */
const LOCAL_WINDOW = 1024 * 1024;
const MAX_LOCAL_READS = 2000;

/** The ids of the extra fields in an extra block; null when the block is malformed. */
function extraIds(extra: Uint8Array): number[] | null {
  const v = view(extra);
  const ids: number[] = [];
  let p = 0;
  while (p + 4 <= extra.length) {
    ids.push(v.getUint16(p, true));
    p += 4 + v.getUint16(p + 2, true);
  }
  return p === extra.length ? ids : null;
}

/**
 * An entry's name as every extractor reads it, or why it cannot be read one way: names must be
 * ASCII, or UTF-8 with the UTF-8 flag set (without it extractors read CP437), and no extra
 * field may give the entry another name.
 */
function entryName(raw: Uint8Array, flags: number, extra: Uint8Array): { name: string } | { problem: string } {
  const ids = extraIds(extra);
  if (!ids) return { problem: "has a damaged extra field" };
  if (ids.some((id) => NAME_OVERRIDES.has(id))) return { problem: "has an extra field that renames it (Unicode Path)" };
  if (raw.some((b) => b >= 0x80) && !(flags & UTF8_FLAG)) return { problem: "has a non-ASCII name without the UTF-8 flag" };
  try {
    return { name: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw) };
  } catch {
    return { problem: "has a name that is not valid UTF-8" };
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Every local header must match its central directory entry: same name bytes, and no extra
 * field that renames it. Extractors that read local headers then see the names checked here.
 */
async function checkLocalHeaders(env: Env, key: string, size: number, entries: Entry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  let reads = 0;
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i]!.offset;
    if (++reads > MAX_LOCAL_READS) throw new Bad("has too many large files to check");
    const buf = await range(env, key, start, Math.min(LOCAL_WINDOW, size - start));
    while (i < sorted.length) {
      const e = sorted[i]!;
      const o = e.offset - start;
      if (o + 30 > buf.length) {
        if (o > 0) break;
        throw new Bad(`has a damaged entry for ${JSON.stringify(e.name.slice(0, 120))}`);
      }
      const shown = JSON.stringify(e.name.slice(0, 120));
      const l = view(buf);
      if (l.getUint32(o, true) !== LOCAL) throw new Bad(`has a damaged entry for ${shown}`);
      const nameLength = l.getUint16(o + 26, true);
      const extraLength = l.getUint16(o + 28, true);
      // A header is at most 30 + 2 × 65535 bytes, well within one window from its start.
      if (o + 30 + nameLength + extraLength > buf.length) {
        if (o > 0) break;
        throw new Bad(`has a damaged entry for ${shown}`);
      }
      if (!sameBytes(buf.subarray(o + 30, o + 30 + nameLength), e.raw)) throw new Bad(`has a local header for ${shown} with another name`);
      const ids = extraIds(buf.subarray(o + 30 + nameLength, o + 30 + nameLength + extraLength));
      if (!ids) throw new Bad(`has a damaged extra field for ${shown}`);
      if (ids.some((id) => NAME_OVERRIDES.has(id))) throw new Bad(`has a local header for ${shown} with an extra field that renames it (Unicode Path)`);
      i++;
    }
  }
}

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
    if (p + 46 + nameLength + extraLength > dir.length) break;
    const raw = dir.slice(p + 46, p + 46 + nameLength);
    const flags = d.getUint16(p + 8, true);
    const named = entryName(raw, flags, dir.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength));
    if ("problem" in named) throw new Bad(`has an entry that ${named.problem}`);
    entries.push({
      name: named.name,
      raw,
      flags,
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

/** A package's manifest.json, which must be a JSON object; throws otherwise. */
export function parseManifest(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Bad(`has a manifest.json that is not valid JSON: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new Bad("has a manifest.json that is not a JSON object");
  return doc as Record<string, unknown>;
}

/**
 * The kind a package's manifest.json declares: schema 1 (or no `schema`) is always an app, and
 * schema 2 names `app` or `service` in `kind`. A string says why the manifest is not supported.
 */
export function manifestKind(manifest: Record<string, unknown>): Kind | { problem: string } {
  const schema = manifest.schema ?? 1;
  if (schema === 1) {
    if (manifest.kind !== undefined && manifest.kind !== "app") return { problem: `manifest.json schema 1 is always an app, but it has kind ${JSON.stringify(manifest.kind)}; use schema 2` };
    return "app";
  }
  if (schema === 2) {
    if (manifest.kind === undefined) return { problem: "manifest.json schema 2 must name its kind (app or service)" };
    if (manifest.kind !== "app" && manifest.kind !== "service") return { problem: `manifest.json has kind ${JSON.stringify(manifest.kind)}, not app or service` };
    return manifest.kind as Kind;
  }
  return { problem: `manifest.json has schema ${JSON.stringify(schema)}; only 1 and 2 are supported` };
}

/**
 * How a manifest differs from what gizlet.toml says it holds (`runtime` defaults to 1, as on the
 * device). Its kind follows its schema: 1 (or none) is an app, 2 names it.
 */
export function manifestMismatches(manifest: Record<string, unknown>, expected: Expected): string[] {
  const kind = manifestKind(manifest);
  if (typeof kind !== "string") return [kind.problem];
  const out = EXPECTED_KEYS.filter((k) => (k === "runtime" ? (manifest.runtime ?? 1) : manifest[k]) !== expected[k]).map(
    (k) => `manifest.json has ${k} ${JSON.stringify(manifest[k] ?? null)}, gizlet.toml says ${JSON.stringify(expected[k])}`,
  );
  if (kind !== expected.kind) out.push(`manifest.json is ${kind === "app" ? "an app" : "a service"}, gizlet.toml says kind ${JSON.stringify(expected.kind)}`);
  return out;
}

/**
 * Why a zip entry name is not a canonical relative path, or null when it is: slash-separated
 * segments with no empty, `.` or `..` segment (a directory may end in one `/`), no backslash,
 * drive letter or control character. Canonical names cannot alias each other through
 * an extractor's path normalization.
 */
export function pathProblem(name: string): string | null {
  if (!name) return "is empty";
  if (name.includes("\\") || /^[A-Za-z]:/.test(name)) return "is not a relative POSIX path";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "has a control character";
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return "is not canonical (empty, . or .. segment)";
  return null;
}

/**
 * The name an entry lands at on any filesystem: without a directory's trailing slash,
 * Unicode NFC and case-folded, so `game` and `Game` (or a file and a directory) collide.
 */
export function landingName(name: string): string {
  return name.replace(/\/$/, "").normalize("NFC").toLowerCase();
}

/** Bytes of an entry executable read for its headers. */
export const EXECUTABLE_HEAD_BYTES = 4096;

/** Mach-O CPU types per target architecture. */
const MACHO_CPU: Record<string, number> = { aarch64: 0x0100000c, arm64: 0x0100000c, arm64e: 0x0100000c, x86_64: 0x01000007, x86_64h: 0x01000007 };
/** PE/COFF machine types per target architecture. */
const PE_MACHINE: Record<string, number> = { x86_64: 0x8664, aarch64: 0xaa64, i686: 0x14c, i586: 0x14c, thumbv7a: 0x1c4 };
const MH_EXECUTE = 2;
const ET_EXEC = 2;
const ET_DYN = 3;

/**
 * Why `head` (the first EXECUTABLE_HEAD_BYTES of the entry) is not an executable for `target`,
 * or null. Checks the format's header and that the architecture matches: the ELF machine and
 * type on Linux; on macOS a thin Mach-O executable of that CPU type, or a universal binary with
 * a slice for it; on Windows a PE image of that machine type.
 */
export function executableProblem(target: string, head: Uint8Array): string | null {
  const [arch = ""] = target.split("-");
  const v = view(head);
  if (target.includes("-linux")) {
    if (head.length < 20 || head[0] !== 0x7f || head[1] !== 0x45 || head[2] !== 0x4c || head[3] !== 0x46) return "is not an ELF executable";
    const little = head[5] !== 2;
    const type = v.getUint16(16, little);
    if (type !== ET_EXEC && type !== ET_DYN) return `is an ELF file of type ${type}, not an executable`;
    const machine = v.getUint16(18, little);
    const want = ELF_MACHINE[arch];
    if (want !== undefined && machine !== want) return `is built for ELF machine ${machine}, not ${arch}`;
    return null;
  }
  if (target.includes("-apple-")) {
    const want = MACHO_CPU[arch];
    if (want === undefined) return `targets ${arch}, which macOS does not run`;
    if (head.length < 16) return "is not a Mach-O executable";
    const le = v.getUint32(0, true);
    if (le === 0xfeedfacf || le === 0xfeedface) {
      const cpu = v.getUint32(4, true);
      if (cpu !== want) return `is a Mach-O executable for CPU type 0x${cpu.toString(16)}, not ${arch}`;
      if (v.getUint32(12, true) !== MH_EXECUTE) return "is a Mach-O file that is not an executable";
      return null;
    }
    const be = v.getUint32(0, false);
    if (be === 0xcafebabe || be === 0xcafebabf) {
      const count = v.getUint32(4, false);
      const stride = be === 0xcafebabf ? 32 : 20;
      // Java class files share this magic; their "count" (the class file version) is far larger.
      if (count < 1 || count > 16 || 8 + count * stride > head.length) return "is not a Mach-O executable";
      for (let i = 0; i < count; i++) if (v.getUint32(8 + i * stride, false) === want) return null;
      return `is a universal binary with no ${arch} slice`;
    }
    return "is not a Mach-O executable";
  }
  if (target.includes("-windows")) {
    const want = PE_MACHINE[arch];
    if (want === undefined) return `targets ${arch}, which has no known Windows machine type`;
    if (head.length < 0x40 || head[0] !== 0x4d || head[1] !== 0x5a) return "is not a Windows executable";
    const pe = v.getUint32(0x3c, true);
    if (pe < 0x40 || pe + 24 > head.length || v.getUint32(pe, true) !== 0x00004550) return "is not a Windows executable (no PE header in its first 4 KiB)";
    const machine = v.getUint16(pe + 4, true);
    if (machine !== want) return `is a Windows executable for machine 0x${machine.toString(16)}, not ${arch}`;
    if (!(v.getUint16(pe + 22, true) & 0x0002)) return "is a PE file that is not an executable image";
    return null;
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
  const landed = new Map<string, string>();
  let unpacked = 0;
  for (const e of entries) {
    const shown = JSON.stringify(e.name.slice(0, 120));
    const problem = pathProblem(e.name);
    if (problem) fail(`has an unsafe path ${shown}: it ${problem}`);
    const other = landed.get(landingName(e.name));
    if (other !== undefined) fail(other === e.name ? `lists ${shown} twice` : `has ${shown} and ${JSON.stringify(other.slice(0, 120))}, which extract to the same place`);
    landed.set(landingName(e.name), e.name);
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
  try {
    await checkLocalHeaders(env, key, size, entries);
  } catch (e) {
    if (e instanceof Bad) return { errors: [`${file} ${e.message}`], warnings };
    throw e;
  }

  const manifestEntry = names.get("manifest.json");
  if (!manifestEntry) return { errors: [`${file} has no manifest.json`], warnings };
  if (manifestEntry.size > MAX_MANIFEST_BYTES) return { errors: [`${file} has a manifest.json larger than 64 KiB`], warnings };
  let manifest: Record<string, unknown>;
  try {
    manifest = parseManifest(new TextDecoder().decode(await readHead(env, key, manifestEntry, MAX_MANIFEST_BYTES)));
  } catch (e) {
    if (e instanceof Bad) return { errors: [`${file} ${e.message}`], warnings };
    throw e;
  }
  for (const m of manifestMismatches(manifest, expected)) fail(m);
  if (errors.length) return { errors, warnings };
  const entry = expected.entry;
  const exe = names.get(entry);
  if (!exe) fail(`has no entry file ${JSON.stringify(entry.slice(0, 120))}`);
  else {
    try {
      const problem = executableProblem(expected.target, await readHead(env, key, exe, EXECUTABLE_HEAD_BYTES));
      if (problem) fail(`entry ${JSON.stringify(entry.slice(0, 120))} ${problem}`);
    } catch (e) {
      if (e instanceof Bad) fail(e.message);
      else throw e;
    }
    if (exe.mode !== null && !(exe.mode & 0o111)) warnings.push(`${file} entry ${JSON.stringify(entry.slice(0, 120))} is not executable`);
  }
  return { errors, warnings };
}

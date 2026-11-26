// A stand-in for github.com, raw.githubusercontent.com and the Actions OIDC issuer, used by
// tests/run-local.sh. It serves releases of fixture repositories with real `.gzl` packages
// (zips with manifest.json and an entry executable), and the repositories' gizlet.toml and art
// at each tag, and signs OIDC tokens with a throwaway key. tests/fixtures/repos/<name> are
// fixture-org/<name> as written by hand; the others are generated below.
//
//   node tests/fixtures/server.mjs 18788
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { exportJWK, SignJWT } from "jose";
import { parse as parseToml } from "smol-toml";

const port = Number(process.argv[2] ?? 18788);
const issuer = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(await exportJWK(publicKey)), kid: "fixture", alg: "RS256", use: "sig" };

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** An Info-ZIP Unicode Path extra field (0x7075) that renames an entry from `from` to `to`. */
function unicodePath(from, to) {
  const data = Buffer.concat([Buffer.from([1]), Buffer.alloc(4), Buffer.from(to)]);
  data.writeUInt32LE(crc32(Buffer.from(from)), 1);
  const head = Buffer.alloc(4);
  head.writeUInt16LE(0x7075, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}

/** A zip archive; entries are { name, data, mode, deflate, extra }. Written as on Unix. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const extra = e.extra ?? Buffer.alloc(0);
    const data = e.deflate ? deflateRawSync(e.data) : e.data;
    const method = e.deflate ? 8 : 0;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, name, extra, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE((e.mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name, extra);
    offset += 30 + name.length + extra.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const ELF_MACHINE = { aarch64: 183, x86_64: 62 };

/** The first bytes of an executable for `target`, padded with noise. */
function executable(target) {
  const arch = target.split("-")[0];
  let head;
  if (target.includes("-apple-")) {
    // mach_header_64: magic, cputype, cpusubtype, filetype MH_EXECUTE.
    head = Buffer.alloc(32);
    head.writeUInt32LE(0xfeedfacf, 0);
    head.writeUInt32LE(arch === "x86_64" ? 0x01000007 : 0x0100000c, 4);
    head.writeUInt32LE(2, 12);
  } else {
    head = Buffer.alloc(64);
    head.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    head.writeUInt16LE(2, 16);
    head.writeUInt16LE(ELF_MACHINE[arch] ?? 0, 18);
  }
  return Buffer.concat([head, randomBytes(8192)]);
}

/** A gizlet.toml for `spec` (the fields of docs/gizlet-toml.md); `literal` writes strings as TOML literal strings. */
function gizletToml(spec, literal = false) {
  const val = (x) => (typeof x === "string" ? (literal ? `'${x}'` : JSON.stringify(x)) : Array.isArray(x) ? `[${x.map(val).join(", ")}]` : String(x));
  const inline = (o) => `{ ${Object.entries(o).map(([k, x]) => `${JSON.stringify(k)} = ${val(x)}`).join(", ")} }`;
  const lines = ["# Written by the fixture server."];
  const tables = [];
  for (const [k, x] of Object.entries(spec)) {
    if (x === undefined || x === null) continue;
    if (k === "controls" || k === "packages") {
      for (const item of x) tables.push("", `[[${k}]]`, ...Object.entries(item).map(([ik, iv]) => `${ik} = ${typeof iv === "object" ? inline(iv) : val(iv)}`));
    } else if (typeof x === "object" && !Array.isArray(x)) {
      tables.push("", `[${k}]`, ...Object.entries(x).map(([ik, iv]) => `${JSON.stringify(ik)} = ${val(iv)}`));
    } else lines.push(`${k} = ${val(x)}`);
  }
  return [...lines, ...tables, ""].join("\n");
}

/** The manifest.json a build writes into a package (docs/gizlet-toml.md). */
function manifestJson(spec, pkg) {
  const m = { schema: 1, id: spec.id, name: spec.name, names: spec.names ?? {}, version: spec.version, description: spec.description, descriptions: spec.descriptions ?? {} };
  return { ...m, color: spec.color, runtime: spec.runtime ?? 1, target: pkg.target, tier: pkg.tier, entry: pkg.entry, icon: "icon.png" };
}

/**
 * A `.gzl` package for one [[packages]] entry. `problem` builds a broken one: symlink | setuid |
 * wrong-arch | traversal | alias (`./<entry>`, an x86-64 build, after the entry) | case (the
 * entry's name capitalized, after it) | unicode-path (an x86-64 `other` that a Unicode Path extra
 * field renames to the entry) | mismatch (manifest.json says another tier).
 */
function gzl(spec, pkg, { problem, files = {} } = {}) {
  const manifest = manifestJson(spec, pkg);
  if (problem === "mismatch") manifest.tier = pkg.tier === "lite" ? "full" : "lite";
  const exeTarget = problem === "wrong-arch" ? "x86_64-unknown-linux-gnu" : pkg.target;
  const other = executable("x86_64-unknown-linux-gnu");
  const entries = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)), mode: 0o100644, deflate: true },
    { name: pkg.entry, data: executable(exeTarget), mode: problem === "setuid" ? 0o104755 : 0o100755, deflate: true },
    { name: "icon.png", data: files.icon ?? PNG, mode: 0o100644 },
    { name: "assets/", data: Buffer.alloc(0), mode: 0o040755 },
    { name: "assets/level.txt", data: Buffer.from("level 1\n"), mode: 0o100644 },
  ];
  if (problem === "symlink") entries.push({ name: "assets/passwd", data: Buffer.from("/etc/passwd"), mode: 0o120777 });
  if (problem === "traversal") entries.push({ name: "assets/../../escape", data: Buffer.from("x"), mode: 0o100644 });
  if (problem === "alias") entries.push({ name: `./${pkg.entry}`, data: other, mode: 0o100755 });
  if (problem === "unicode-path") entries.push({ name: "other", data: other, mode: 0o100755, extra: unicodePath("other", pkg.entry) });
  if (problem === "case") entries.push({ name: pkg.entry.replace(/^./, (c) => c.toUpperCase()), data: other, mode: 0o100755 });
  const sums = entries.filter((e) => !e.name.endsWith("/") && (e.mode & 0o170000) === 0o100000).map((e) => `${sha(e.data)}  ${e.name}`);
  entries.push({ name: "CHECKSUMS", data: Buffer.from(`${sums.join("\n")}\n`), mode: 0o100644 });
  return zip(entries);
}

const packageFile = (spec, p) => `${spec.id}-${spec.version}-${p.target}-${p.tier}.gzl`;

/** repo -> { latest, tags: { tag -> { assets: Map<name, Buffer>, files: Map<path, Buffer> } } } */
const repos = new Map();

function addTag(repo, tag, assets, files) {
  const r = repos.get(repo) ?? { tags: {}, latest: null };
  files.set("README.md", Buffer.from(`# ${repo}\n`));
  r.tags[tag] = { assets, files };
  r.latest = tag;
  repos.set(repo, r);
}

/** A release of a generated fixture gizlet: gizlet.toml and its art in the repository, packages in the release. */
function addRelease(repo, version, { category = "game", targets, page = true, problem, literal, extra = [], icon = true, iconPath = "store/icon.png", description = true, missing = false } = {}) {
  const hello = repo === "fixture-org/hello-gizlet";
  const files = new Map();
  if (icon) files.set("store/icon.png", PNG);
  files.set("store/screenshot-1.png", PNG);
  if (page) files.set("store/cover.png", PNG);
  if (page) files.set("store/about.en.md", Buffer.from("## About Hello\n\nServe yourself **sushi** from the belt.\n"));
  const spec = {
    id: `dev.fixture.${repo.split("/")[1].replace(/[^a-z0-9]/g, "")}`,
    name: hello ? "Hello Gizlet" : repo.split("/")[1],
    version,
    category,
    description: description ? "A fixture gizlet for the tests." : undefined,
    tags: ["fixture", "arcade"],
    color: "#2fa37a",
    icon: icon ? iconPath : undefined,
    cover: page ? "store/cover.png" : undefined,
    screenshots: ["store/screenshot-1.png"],
    names: hello ? { "zh-CN": "你好 Gizlet" } : undefined,
    descriptions: description ? { "zh-CN": "测试用的示例。" } : undefined,
    about: page ? { en: "store/about.en.md" } : undefined,
    controls: [{ button: "a", action: "Eat", actions: { "zh-CN": "吃" } }],
    packages: (targets ?? [
      ["aarch64-unknown-linux-gnu", "lite"],
      ["aarch64-apple-darwin", "lite"],
      ["aarch64-apple-darwin", "full"],
    ]).map(([target, tier]) => ({ target, tier, entry: "game" })),
  };
  files.set("gizlet.toml", Buffer.from(gizletToml(spec, literal)));
  const assets = new Map();
  // `missing`: the first package listed in gizlet.toml was never uploaded.
  for (const p of spec.packages.slice(missing ? 1 : 0)) assets.set(packageFile(spec, p), gzl(spec, p, { problem }));
  // Release assets gizlet.toml does not name; never served.
  for (const name of extra) assets.set(name, gzl(spec, { target: "x86_64-unknown-linux-gnu", tier: "lite", entry: "game" }));
  addTag(repo, `v${version}`, assets, files);
}

/** A fixture repository written out under tests/fixtures/repos/<name>, with its own gizlet.toml and art. */
function addRepoDir(name) {
  const root = join(REPOS, name);
  const files = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else files.set(path, readFileSync(join(root, path)));
    }
  };
  walk("");
  const spec = parseToml(files.get("gizlet.toml").toString());
  const icon = spec.icon ? files.get(spec.icon) : undefined;
  const assets = new Map(spec.packages.map((p) => [packageFile(spec, p), gzl(spec, p, { files: { icon } })]));
  addTag(`fixture-org/${name}`, `v${spec.version}`, assets, files);
}

const REPOS = join(dirname(fileURLToPath(import.meta.url)), "repos");
for (const name of readdirSync(REPOS)) addRepoDir(name);

addRelease("fixture-org/hello-gizlet", "0.1.0");
addRelease("fixture-org/hello-gizlet", "0.2.0", { extra: ["unsafe.gzl"] });
// Fine to install, but no icon or description: stays unlisted.
addRelease("fixture-org/on-demand", "1.0.0", { category: "app", page: false, icon: false, description: false, targets: [["x86_64-unknown-linux-gnu", "full"]] });
// Used only by the device simulation (tests/sim/device.mjs).
addRelease("fixture-org/pocket-sim", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/missing-package", "0.1.0", { missing: true });
addRelease("fixture-org/symlink", "0.1.0", { problem: "symlink" });
addRelease("fixture-org/setuid", "0.1.0", { problem: "setuid" });
addRelease("fixture-org/wrong-arch", "0.1.0", { problem: "wrong-arch", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/traversal", "0.1.0", { problem: "traversal", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/alias", "0.1.0", { problem: "alias", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/unicode-path", "0.1.0", { problem: "unicode-path", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/mismatch", "0.1.0", { problem: "mismatch", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Names a package as its icon; refused at publish.
addRelease("fixture-org/gzl-icon", "0.1.0", { iconPath: "store/unchecked.gzl", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/case", "0.1.0", { problem: "case", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/literal-toml", "0.1.0", { literal: true, targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addTag("fixture-org/no-index", "v1.0.0", new Map([["other.zip", Buffer.from("x")]]), new Map());

async function token(repo, ref) {
  return new SignJWT({ repository: repo, repository_id: "424242", repository_owner: repo.split("/")[0], repository_visibility: "public", ref, event_name: "push" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(issuer)
    .setAudience("https://api.gizlet.io")
    .setSubject(`repo:${repo}:ref:${ref}`)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, headers);
    res.end(body);
  };
  if (url.pathname === "/.well-known/jwks") return send(200, JSON.stringify({ keys: [jwk] }), { "content-type": "application/json" });
  if (url.pathname === "/token") {
    const repo = url.searchParams.get("repo") ?? "fixture-org/hello-gizlet";
    const ref = url.searchParams.get("ref") ?? "refs/tags/v0.1.0";
    return send(200, JSON.stringify({ value: await token(repo, ref) }), { "content-type": "application/json" });
  }
  if (url.pathname === "/healthz") return send(200, "ok");
  const [owner, name, ...rest] = parts;
  const repo = repos.get(`${owner}/${name}`.toLowerCase());
  if (!repo) return send(404, "Not Found");
  if (rest.join("/") === "releases/latest") return send(302, "", { location: `https://github.com/${owner}/${name}/releases/tag/${repo.latest}` });
  // github.com: release assets.
  if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4) {
    const file = repo.tags[rest[2]]?.assets.get(rest[3]);
    if (!file) return send(404, "Not Found");
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }
  // raw.githubusercontent.com: repository files at a tag.
  const file = repo.tags[rest[0]]?.files.get(rest.slice(1).join("/"));
  if (file) return send(200, file, { "content-length": String(file.length), "content-type": "text/plain; charset=utf-8" });
  send(404, "Not Found");
}).listen(port, "127.0.0.1", () => console.log(`fixture server on ${issuer}`));

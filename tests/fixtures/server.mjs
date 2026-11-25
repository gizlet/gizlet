// A stand-in for github.com, raw.githubusercontent.com and the Actions OIDC issuer, used by
// tests/run-local.sh. It serves releases of fixture repositories with real `.gzl` packages
// (zips with manifest.toml and an entry executable) and signs OIDC tokens with a throwaway key.
//
//   node tests/fixtures/server.mjs 18788
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { crc32, deflateRawSync } from "node:zlib";
import { exportJWK, SignJWT } from "jose";

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

/**
 * A `.gzl` package. `problem` builds a broken one: symlink | setuid | wrong-arch | traversal |
 * alias (`./game`, an x86-64 build, after `game`) | case (`Game` after `game`) |
 * unicode-path (an x86-64 `other` that a Unicode Path extra field renames to `game`).
 * `literal` writes manifest.toml with TOML literal strings.
 */
function gzl({ id, version, target, tier, problem, literal }) {
  const str = (v) => (literal ? `'${v}'` : JSON.stringify(v));
  const manifest = [
    "# Written by the fixture server.",
    `id = ${str(id)}`,
    `name = ${str("Fixture")}`,
    `version = ${str(version)}`,
    `tier = ${str(tier)}`,
    `target = ${str(target)}`,
    `entry = ${str("game")}`,
    `icon = ${str("icon.png")}`,
    "",
    "[names]",
    `"zh-CN" = "示例"`,
  ].join("\n");
  const exeTarget = problem === "wrong-arch" ? "x86_64-unknown-linux-gnu" : target;
  const entries = [
    { name: "manifest.toml", data: Buffer.from(manifest), mode: 0o100644, deflate: true },
    { name: "game", data: executable(exeTarget), mode: problem === "setuid" ? 0o104755 : 0o100755, deflate: true },
    { name: "icon.png", data: PNG, mode: 0o100644 },
    { name: "assets/", data: Buffer.alloc(0), mode: 0o040755 },
    { name: "assets/level.txt", data: Buffer.from("level 1\n"), mode: 0o100644 },
    { name: "CHECKSUMS", data: Buffer.from("fixture\n"), mode: 0o100644 },
  ];
  if (problem === "symlink") entries.push({ name: "assets/passwd", data: Buffer.from("/etc/passwd"), mode: 0o120777 });
  if (problem === "traversal") entries.push({ name: "assets/../../escape", data: Buffer.from("x"), mode: 0o100644 });
  if (problem === "alias") entries.push({ name: "./game", data: executable("x86_64-unknown-linux-gnu"), mode: 0o100755 });
  if (problem === "unicode-path") entries.push({ name: "other", data: executable("x86_64-unknown-linux-gnu"), mode: 0o100755, extra: unicodePath("other", "game") });
  if (problem === "case") entries.push({ name: "Game", data: executable("x86_64-unknown-linux-gnu"), mode: 0o100755 });
  return zip(entries);
}

/** repo -> { latest, tags: { tag -> { files: Map<name, Buffer> } } } */
const repos = new Map();

function addRelease(repo, version, { category = "game", lie = false, targets, page = true, problem, literal, extra = [], icon = true, iconName = "icon.png", description = true } = {}) {
  const tag = `v${version}`;
  const id = `dev.fixture.${repo.split("/")[1].replace(/[^a-z0-9]/g, "")}`;
  const files = new Map();
  const packages = [];
  for (const [target, tier] of targets ?? [
    ["aarch64-unknown-linux-gnu", "lite"],
    ["aarch64-apple-darwin", "lite"],
    ["aarch64-apple-darwin", "full"],
  ]) {
    const file = `${id}-${version}-${target}-${tier}.gzl`;
    const body = gzl({ id, version, target, tier, problem, literal });
    files.set(file, body);
    packages.push({ file, target, tier, size: body.length, sha256: lie ? sha(Buffer.from("not this")) : sha(body) });
  }
  if (icon) files.set("icon.png", PNG);
  files.set("screenshot-1.png", PNG);
  if (page) files.set("cover.png", PNG);
  if (page) files.set("about.en.md", Buffer.from("# About Hello\n\nServe yourself **sushi** from the belt.\n"));
  const index = {
    schema: 1,
    id,
    name: repo === "fixture-org/hello-gizlet" ? "Hello Gizlet" : repo.split("/")[1],
    names: repo === "fixture-org/hello-gizlet" ? { "zh-CN": "你好 Gizlet" } : {},
    version,
    description: description ? "A fixture gizlet for the tests." : null,
    descriptions: description ? { "zh-CN": "测试用的示例。" } : {},
    category,
    tags: ["fixture", "arcade"],
    color: "#2fa37a",
    icon: icon ? iconName : null,
    screenshots: ["screenshot-1.png"],
    cover: page ? "cover.png" : null,
    about: page ? { en: "about.en.md" } : {},
    controls: [{ button: "a", action: "Eat", actions: { "zh-CN": "吃" } }],
    packages,
  };
  files.set("gizlet.json", Buffer.from(JSON.stringify(index, null, 2)));
  // Release assets gizlet.json does not name; never served.
  for (const name of extra) files.set(name, gzl({ id, version, target: "x86_64-unknown-linux-gnu", tier: "lite" }));
  const r = repos.get(repo) ?? { tags: {}, latest: null };
  r.tags[tag] = { files };
  r.latest = tag;
  repos.set(repo, r);
}

addRelease("fixture-org/hello-gizlet", "0.1.0");
addRelease("fixture-org/hello-gizlet", "0.2.0", { extra: ["unsafe.gzl"] });
// Fine to install, but no icon or description: stays unlisted.
addRelease("fixture-org/on-demand", "1.0.0", { category: "app", page: false, icon: false, description: false, targets: [["x86_64-unknown-linux-gnu", "full"]] });
// Used only by the device simulation (tests/sim/device.mjs).
addRelease("fixture-org/pocket-sim", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/bad-sum", "0.1.0", { lie: true });
addRelease("fixture-org/symlink", "0.1.0", { problem: "symlink" });
addRelease("fixture-org/setuid", "0.1.0", { problem: "setuid" });
addRelease("fixture-org/wrong-arch", "0.1.0", { problem: "wrong-arch", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/traversal", "0.1.0", { problem: "traversal", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/alias", "0.1.0", { problem: "alias", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/unicode-path", "0.1.0", { problem: "unicode-path", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Names an extra, unchecked package as its icon; refused at publish.
addRelease("fixture-org/gzl-icon", "0.1.0", { iconName: "unchecked.gzl", extra: ["unchecked.gzl"], targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/case", "0.1.0", { problem: "case", targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/literal-toml", "0.1.0", { literal: true, targets: [["aarch64-unknown-linux-gnu", "lite"]] });
repos.set("fixture-org/no-index", { tags: { "v1.0.0": { files: new Map([["other.zip", Buffer.from("x")]]) } }, latest: "v1.0.0" });

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
  if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4) {
    const file = repo.tags[rest[2]]?.files.get(rest[3]);
    if (!file) return send(404, "Not Found");
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }
  if (rest.length === 2 && rest[1] === "README.md" && repo.tags[rest[0]]) return send(200, "# Fixture\n", { "content-type": "text/plain" });
  send(404, "Not Found");
}).listen(port, "127.0.0.1", () => console.log(`fixture server on ${issuer}`));

// A stand-in for github.com, raw.githubusercontent.com, api.github.com (as the GitHub App
// gizlet-bot sees it) and the Actions OIDC issuer, used by tests/run-local.sh. It serves releases
// of fixture repositories with real `.gzl` packages (zips with manifest.toml and an entry
// executable) and signs OIDC tokens with a throwaway key.
//
// The app is installed on the repositories in INSTALLED; PRIVATE ones are not on the web at all.
// Its private key is GET /_fixture/app-key, its client id APP_CLIENT_ID. Tests can add a release
// (POST /_fixture/release?repo=&version=), rewrite a release's description around the same
// packages (POST /_fixture/describe?repo=&tag=&description=), make the API hand over asset bytes
// directly instead of redirecting (POST /_fixture/direct?repo=) and count requests
// (GET /_fixture/hits?key=&since=).
//
//   node tests/fixtures/server.mjs 18788
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { crc32, deflateRawSync } from "node:zlib";
import { exportJWK, jwtVerify, SignJWT } from "jose";

const port = Number(process.argv[2] ?? 18788);
const issuer = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(await exportJWK(publicKey)), kid: "fixture", alg: "RS256", use: "sig" };

// The GitHub App. GitHub issues PKCS#1 keys.
const APP_CLIENT_ID = "Iv-fixture";
const INSTALLATION = 77;
/** Installed on fixture-org/suspended (public), but suspended: no tokens. */
const SUSPENDED = 78;
const app = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APP_KEY = app.privateKey.export({ type: "pkcs1", format: "pem" });
const INSTALLED = new Set(["fixture-org/hello-gizlet", "fixture-org/secret-gizlet"]);
const PRIVATE = new Set(["fixture-org/secret-gizlet", "fixture-org/hidden"]);
const tokens = new Set();
/** Asset id -> { repo, tag, name }, and signed download URLs: sig -> the same. */
const assets = new Map();
const signed = new Map();
/** Repositories whose asset API answers 200 with the bytes, which GitHub may do instead of a 302. */
const DIRECT = new Set();
/** Repositories renamed or moved: their asset API redirects to /repositories/<id>/releases/assets/<id>. */
const RELOCATED = new Set();
let nextAssetId = 1000;
/** Request counts by key, e.g. latest:<repo>, api:<repo>, signed:<repo>. */
const hits = new Map();
const hit = (key) => hits.set(key, (hits.get(key) ?? 0) + 1);

// 1×1 PNG, for the icons inside packages.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Release art, so the site shows a real picture: a low-poly rocket snail.
const ICON = readFileSync(new URL("art/icon.jpg", import.meta.url));
const COVER = readFileSync(new URL("art/cover.jpg", import.meta.url));

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

function addRelease(repo, version, { category = "game", lie = false, targets, page = true, problem, literal, extra = [], icon = true, iconName = "icon.jpg", description = true } = {}) {
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
  if (icon) files.set("icon.jpg", ICON);
  files.set("screenshot-1.jpg", COVER);
  if (page) files.set("cover.jpg", COVER);
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
    screenshots: ["screenshot-1.jpg"],
    cover: page ? "cover.jpg" : null,
    about: page ? { en: "about.en.md" } : {},
    controls: [{ button: "a", action: "Eat", actions: { "zh-CN": "吃" } }],
    packages,
  };
  files.set("gizlet.json", Buffer.from(JSON.stringify(index, null, 2)));
  // Release assets gizlet.json does not name; never served.
  for (const name of extra) files.set(name, gzl({ id, version, target: "x86_64-unknown-linux-gnu", tier: "lite" }));
  const ids = new Map();
  for (const name of files.keys()) {
    const assetId = nextAssetId++;
    ids.set(name, assetId);
    assets.set(assetId, { repo, tag, name });
  }
  const r = repos.get(repo) ?? { tags: {}, latest: null };
  r.tags[tag] = { files, ids };
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
repos.set("fixture-org/no-index", { tags: { "v1.0.0": { files: new Map([["other.zip", Buffer.from("x")]]), ids: new Map() } }, latest: "v1.0.0" });
// Visited by tests/hurl/07-refresh.hurl, which adds releases while it runs.
addRelease("fixture-org/refresh-me", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Private, with the app installed: read only through the API. Three releases, so the oldest is pruned from R2.
addRelease("fixture-org/secret-gizlet", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/secret-gizlet", "1.1.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/secret-gizlet", "1.2.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Private, without the app: Gizlet cannot see it.
addRelease("fixture-org/hidden", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Scanned infected by tests/hurl/08-marks.hurl.
addRelease("fixture-org/infected", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// Public, with a suspended installation of the app: read through the web.
addRelease("fixture-org/suspended", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
// The same files released in two repositories; 08-marks.hurl reports twin-a infected.
addRelease("fixture-org/twin-a", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
{
  const src = repos.get("fixture-org/twin-a").tags["v1.0.0"];
  const ids = new Map();
  for (const name of src.files.keys()) {
    const assetId = nextAssetId++;
    ids.set(name, assetId);
    assets.set(assetId, { repo: "fixture-org/twin-b", tag: "v1.0.0", name });
  }
  repos.set("fixture-org/twin-b", { tags: { "v1.0.0": { files: src.files, ids } }, latest: "v1.0.0" });
}

async function token(repo, ref, visibility = "public") {
  return new SignJWT({ repository: repo, repository_id: "424242", repository_owner: repo.split("/")[0], repository_visibility: visibility, ref, event_name: "push" })
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
    const visibility = url.searchParams.get("visibility") ?? "public";
    return send(200, JSON.stringify({ value: await token(repo, ref, visibility) }), { "content-type": "application/json" });
  }
  if (url.pathname === "/healthz") return send(200, "ok");
  const json = (status, body) => send(status, JSON.stringify(body), { "content-type": "application/json" });

  // Test controls.
  if (url.pathname === "/_fixture/app-key") return send(200, APP_KEY, { "content-type": "text/plain" });
  if (url.pathname === "/_fixture/hits") {
    const count = hits.get(url.searchParams.get("key")) ?? 0;
    return json(200, { count, since: count - Number(url.searchParams.get("since") ?? 0) });
  }
  if (url.pathname === "/_fixture/relocate" && req.method === "POST") {
    RELOCATED.add(url.searchParams.get("repo"));
    return json(200, { relocated: [...RELOCATED] });
  }
  if (url.pathname === "/_fixture/direct" && req.method === "POST") {
    DIRECT.add(url.searchParams.get("repo"));
    return json(200, { direct: [...DIRECT] });
  }
  if (url.pathname === "/_fixture/describe" && req.method === "POST") {
    const files = repos.get(url.searchParams.get("repo"))?.tags[url.searchParams.get("tag")]?.files;
    if (!files) return json(404, { message: "no such fixture release" });
    const index = JSON.parse(files.get("gizlet.json"));
    index.description = url.searchParams.get("description");
    files.set("gizlet.json", Buffer.from(JSON.stringify(index, null, 2)));
    return json(200, index);
  }
  if (url.pathname === "/_fixture/release" && req.method === "POST") {
    const key = url.searchParams.get("repo");
    if (!repos.has(key)) return json(404, { message: "no such fixture repository" });
    addRelease(key, url.searchParams.get("version"), { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
    return json(201, { latest: repos.get(key).latest });
  }

  // api.github.com as the app sees it.
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const asApp = async () => {
    try {
      await jwtVerify(bearer ?? "", app.publicKey, { issuer: APP_CLIENT_ID, algorithms: ["RS256"] });
      return true;
    } catch {
      return false;
    }
  };
  if (parts[0] === "app" && parts[1] === "installations" && parts[3] === "access_tokens" && req.method === "POST") {
    if (!(await asApp())) return json(401, { message: "A JSON web token could not be decoded" });
    if (Number(parts[2]) === SUSPENDED) return json(403, { message: "This installation has been suspended" });
    if (Number(parts[2]) !== INSTALLATION) return json(404, { message: "Not Found" });
    const t = `ghs_fixture${randomBytes(12).toString("hex")}`;
    tokens.add(t);
    return json(201, { token: t, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  }
  if (parts[0] === "repos") {
    const [, owner, name, ...rest] = parts;
    const key = `${owner}/${name}`.toLowerCase();
    if (rest.join("/") === "installation") {
      if (!(await asApp())) return json(401, { message: "A JSON web token could not be decoded" });
      if (key === "fixture-org/suspended") return json(200, { id: SUSPENDED });
      return INSTALLED.has(key) ? json(200, { id: INSTALLATION }) : json(404, { message: "Not Found" });
    }
    if (!bearer || !tokens.has(bearer)) return json(401, { message: "Bad credentials" });
    const repo = repos.get(key);
    if (!repo || !INSTALLED.has(key)) return json(404, { message: "Not Found" });
    hit(`api:${key}`);
    const release = (tag) => ({ tag_name: tag, assets: [...repo.tags[tag].ids].map(([n, assetId]) => ({ id: assetId, name: n })) });
    if (rest.length === 0) return json(200, { id: 900 + [...INSTALLED].indexOf(key), name, owner: { login: owner }, private: PRIVATE.has(key) });
    if (rest.join("/") === "releases/latest") {
      hit(`latest:${key}`);
      return repo.latest ? json(200, release(repo.latest)) : json(404, { message: "Not Found" });
    }
    if (rest[0] === "releases" && rest[1] === "tags" && rest.length === 3) return repo.tags[rest[2]] ? json(200, release(rest[2])) : json(404, { message: "Not Found" });
    if (rest[0] === "releases" && rest[1] === "assets" && rest.length === 3) {
      const a = assets.get(Number(rest[2]));
      if (!a || a.repo !== key) return json(404, { message: "Not Found" });
      if (RELOCATED.has(key)) return send(301, "", { location: `${issuer}/repositories/${900 + [...INSTALLED].indexOf(key)}/releases/assets/${rest[2]}` });
      return serveAsset(a, Number(rest[2]));
    }
    return json(404, { message: "Not Found" });
  }
  // A relocated repository's asset, by repository id; needs the token and the Accept header again.
  if (parts[0] === "repositories" && parts[2] === "releases" && parts[3] === "assets" && parts.length === 5) {
    if (!bearer || !tokens.has(bearer)) return json(401, { message: "Bad credentials" });
    const a = assets.get(Number(parts[4]));
    if (!a || 900 + [...INSTALLED].indexOf(a.repo) !== Number(parts[1])) return json(404, { message: "Not Found" });
    hit(`relocated:${a.repo}`);
    return serveAsset(a, Number(parts[4]));
  }
  function serveAsset(a, assetId) {
    const key = a.repo;
    const repo = repos.get(key);
    {
      if (req.headers.accept !== "application/octet-stream") return json(200, { id: assetId, name: a.name });
      if (DIRECT.has(key)) {
        hit(`direct:${key}`);
        const file = repo.tags[a.tag].files.get(a.name);
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : file.length - 1, file.length - 1);
          if (start > end) return send(416, "", { "content-range": `bytes */${file.length}` });
          return send(206, file.subarray(start, end + 1), {
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${file.length}`,
            "accept-ranges": "bytes",
            "content-type": "application/octet-stream",
          });
        }
        return send(200, file, { "content-length": String(file.length), "accept-ranges": "bytes", "content-type": "application/octet-stream" });
      }
      const sig = randomBytes(16).toString("hex");
      signed.set(sig, a);
      return send(302, "", { location: `${issuer}/_signed/${sig}` });
    }
  }
  // A short-lived asset URL from the API. Like GitHub's, it refuses a second credential.
  if (parts[0] === "_signed") {
    const a = signed.get(parts[1]);
    if (!a) return send(404, "Not Found");
    if (req.headers.authorization) return send(400, "Only one auth mechanism allowed");
    hit(`signed:${a.repo}`);
    const file = repos.get(a.repo).tags[a.tag].files.get(a.name);
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }

  // github.com and raw.githubusercontent.com: public repositories only.
  const [owner, name, ...rest] = parts;
  const key = `${owner}/${name}`.toLowerCase();
  const repo = PRIVATE.has(key) ? undefined : repos.get(key);
  if (!repo) return send(404, "Not Found");
  if (rest.join("/") === "releases/latest") {
    hit(`latest:${key}`);
    return send(302, "", { location: `https://github.com/${owner}/${name}/releases/tag/${repo.latest}` });
  }
  if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4) {
    const file = repo.tags[rest[2]]?.files.get(rest[3]);
    if (!file) return send(404, "Not Found");
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }
  if (rest.length === 2 && rest[1] === "README.md" && repo.tags[rest[0]]) return send(200, "# Fixture\n", { "content-type": "text/plain" });
  send(404, "Not Found");
}).listen(port, "127.0.0.1", () => console.log(`fixture server on ${issuer}`));

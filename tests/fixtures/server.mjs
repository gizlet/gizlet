// A stand-in for github.com, raw.githubusercontent.com, api.github.com (as the GitHub App
// the Gizlet App sees it) and the Actions OIDC issuer, used by tests/run-local.sh. It serves the
// fixture repositories' files at each tag (gizlet.toml and art) and their releases with real
// `.gzl` packages (zips with manifest.json and an entry executable), and signs OIDC tokens with a
// throwaway key. tests/fixtures/repos/<name> are fixture-org/<name> as written by hand; the
// others are generated below.
//
// The app is installed on the repositories in INSTALLED; PRIVATE ones are not on the web at all.
// Its private key is GET /_fixture/app-key, its client id APP_CLIENT_ID. Tests can add a release
// (POST /_fixture/release?repo=&version=), rewrite a release's description in its gizlet.toml
// around the same packages (POST /_fixture/describe?repo=&tag=&description=), make the API hand
// over asset bytes directly instead of redirecting (POST /_fixture/direct?repo=), hold a public
// repository's release downloads until it is let go (POST /_fixture/hold?repo=, then
// /_fixture/release-hold?repo=) and count requests (GET /_fixture/hits?key=&since=).
//
// It is also GitHub for the OAuth app accounts sign in and link with: the users in USERS, their
// organizations and their permissions on the fixture repositories. GET /login/oauth/authorize
// lists them as links in a browser; ?fixture_login=<login> picks one at once. A user's tokens can
// be revoked (POST /_fixture/revoke?login=), as when someone removes the app on GitHub.
// POST /_fixture/replace?repo= gives the repository at a path another GitHub id, as when it is
// deleted and someone creates another at the same path; POST /_fixture/hide?repo=&hidden=1|0 takes
// a public repository off GitHub for a while, as when it is made private; POST
// /_fixture/rename?repo=&to= renames a repository and creates another at its old path. Users' tokens
// have no `repo` scope, so they do not see private repositories; the app reads users' roles on the
// repositories it is installed on.
//
//   node tests/fixtures/server.mjs 18788
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { exportJWK, jwtVerify, SignJWT } from "jose";
import { parse as parseToml } from "smol-toml";

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
const assets_ = new Map();
const signed = new Map();
/** Repositories whose asset API answers 200 with the bytes, which GitHub may do instead of a 302. */
const DIRECT = new Set();
/** Public repositories whose release downloads wait until the hold is let go: repo -> waiting resolvers. */
const HELD = new Map();
/** Repositories renamed or moved: their asset API redirects to /repositories/<id>/releases/assets/<id>. */
const RELOCATED = new Set();
let nextAssetId = 1000;
/** Request counts by key, e.g. latest:<repo>, api:<repo>, signed:<repo>. */
const hits = new Map();
const hit = (key) => hits.set(key, (hits.get(key) ?? 0) + 1);

/** Repositories replaced by another at the same path (POST /_fixture/replace), with their new id. */
const REPLACED = new Map();
/** Public repositories off GitHub for now (POST /_fixture/hide). */
const HIDDEN = new Set();
/** A repository's GitHub id, stable per repository (the API, OIDC tokens and asset URLs agree). */
function repoId(key) {
  if (REPLACED.has(key)) return REPLACED.get(key);
  let h = 0x811c9dc5;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return 100000 + (h % 900000);
}

// The OAuth app accounts sign in with, and its users. `perm` is a user's role on a fixture
// repository: admin, maintain, push or pull, or null where they cannot see it.
const OAUTH_CLIENT_ID = "Ov-fixture";
const OAUTH_CLIENT_SECRET = "fixture-oauth-secret";
const USERS = {
  "fixture-dev": { id: 7001, name: "Fixture Dev", email: "dev@fixture.test", orgs: ["fixture-org"], perm: () => "admin" },
  "fixture-maintainer": { id: 7002, name: "Mae Tainer", email: "mae@fixture.test", orgs: ["fixture-org"], perm: (key) => (key === "fixture-org/hello-gizlet" ? "maintain" : "push") },
  "fixture-viewer": { id: 7003, name: "Vi Ewer", email: "vi@fixture.test", orgs: ["fixture-org"], perm: () => "pull" },
  "fixture-loner": { id: 7004, name: "Lone Wolf", email: "lone@fixture.test", orgs: [], perm: () => null },
};
const ROLES = ["pull", "triage", "push", "maintain", "admin"];
const permissions = (role) => Object.fromEntries(ROLES.map((r) => [r, ROLES.indexOf(r) <= ROLES.indexOf(role)]));
/** One-time codes and access tokens of the OAuth app: code -> login, token -> login. */
const oauthCodes = new Map();
const userTokens = new Map();

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

/**
 * The manifest.json a build writes into a package (docs/gizlet-toml.md): schema 1 for an app,
 * schema 2 with its kind for a service. `manifest` overrides fields, `undefined` leaving one out.
 */
function manifestJson(spec, pkg, manifest = {}) {
  const kind = spec.kind ?? "app";
  const head = kind === "app" ? { schema: 1 } : { schema: 2, kind };
  const m = { ...head, id: spec.id, name: spec.name, names: spec.names ?? {}, version: spec.version, description: spec.description, descriptions: spec.descriptions ?? {} };
  return { ...m, color: spec.color, runtime: spec.runtime ?? 1, target: pkg.target, tier: pkg.tier, entry: pkg.entry, icon: "icon.png", ...manifest };
}

/**
 * A `.gzl` package for one [[packages]] entry. `problem` builds a broken one: symlink | setuid |
 * wrong-arch | traversal | alias (`./<entry>`, an x86-64 build, after the entry) | case (the
 * entry's name capitalized, after it) | unicode-path (an x86-64 `other` that a Unicode Path extra
 * field renames to the entry) | mismatch (manifest.json says another tier). `manifest` overrides
 * manifest.json fields.
 */
function gzl(spec, pkg, { problem, files = {}, manifest: fields } = {}) {
  const manifest = manifestJson(spec, pkg, fields);
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

/**
 * repo -> { latest, tags: { tag -> { assets: Map<name, Buffer>, ids: Map<name, asset id>,
 * files: Map<path, Buffer>, spec } } }: release assets, and the repository's files at the tag.
 */
const repos = new Map();

function addTag(repo, tag, assets, files, spec = null) {
  const r = repos.get(repo) ?? { tags: {}, latest: null };
  files.set("README.md", Buffer.from(`# ${repo}\n`));
  const ids = new Map();
  for (const name of assets.keys()) {
    const assetId = nextAssetId++;
    ids.set(name, assetId);
    assets_.set(assetId, { repo, tag, name });
  }
  r.tags[tag] = { assets, ids, files, spec };
  r.latest = tag;
  repos.set(repo, r);
}

/** A release of a generated fixture gizlet: gizlet.toml and its art in the repository, packages in the release. */
function addRelease(repo, version, { kind, category = kind === "service" ? undefined : "game", targets, page = true, problem, manifest, literal, extra = [], icon = true, iconPath = "store/icon.png", description = true, missing = false } = {}) {
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
    kind,
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
  for (const p of spec.packages.slice(missing ? 1 : 0)) assets.set(packageFile(spec, p), gzl(spec, p, { problem, manifest }));
  // Release assets gizlet.toml does not name; never served.
  for (const name of extra) assets.set(name, gzl(spec, { target: "x86_64-unknown-linux-gnu", tier: "lite", entry: "game" }));
  addTag(repo, `v${version}`, assets, files, spec);
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
  addTag(`fixture-org/${name}`, `v${spec.version}`, assets, files, spec);
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
// Kinds and manifest schemas (tests/hurl/10-kinds.hurl): a schema 2 service, a schema 2 app, an
// app whose manifest.json leaves out its schema, and packages whose manifest.json disagrees.
const handheld = [["aarch64-unknown-linux-gnu", "lite"]];
addRelease("fixture-org/clock-service", "1.0.0", { kind: "service", targets: handheld });
addRelease("fixture-org/v2-app", "1.0.0", { category: "app", manifest: { schema: 2, kind: "app" }, targets: handheld });
addRelease("fixture-org/no-schema", "1.0.0", { manifest: { schema: undefined }, targets: handheld });
addRelease("fixture-org/service-as-v1", "1.0.0", { kind: "service", manifest: { schema: 1, kind: undefined }, targets: handheld });
addRelease("fixture-org/v2-no-kind", "1.0.0", { manifest: { schema: 2 }, targets: handheld });
addRelease("fixture-org/v1-service-kind", "1.0.0", { manifest: { kind: "service" }, targets: handheld });
addRelease("fixture-org/schema-3", "1.0.0", { manifest: { schema: 3, kind: "app" }, targets: handheld });
// A service for handhelds that became an x86-64-only app: a handheld still installs the service.
addRelease("fixture-org/turncoat", "1.0.0", { kind: "service", targets: handheld });
// An arm64 full package and an x86-64 lite one: nothing for an arm64 lite handheld (tests/hurl/11-device-store.hurl).
// Replaced by another repository at its path that publishes the same id (tests/hurl/11-device-store.hurl).
addRelease("fixture-org/path-reuse", "1.0.0", { targets: handheld });
// Deleted and created again at its path with the very same release (tests/hurl/11-device-store.hurl).
addRelease("fixture-org/recreated", "1.0.0", { targets: handheld });
addRelease("fixture-org/mixed-tiers", "1.0.0", { targets: [["aarch64-unknown-linux-gnu", "full"], ["x86_64-unknown-linux-gnu", "lite"]] });
addRelease("fixture-org/turncoat", "2.0.0", { targets: [["x86_64-unknown-linux-gnu", "lite"]] });
addTag("fixture-org/no-index", "v1.0.0", new Map([["other.zip", Buffer.from("x")]]), new Map());
// Visited by tests/hurl/07-index.hurl, which adds releases while it runs.
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
  addTag("fixture-org/twin-b", "v1.0.0", new Map(src.assets), new Map(src.files), src.spec);
}

async function token(repo, ref, visibility = "public") {
  return new SignJWT({ repository: repo, repository_id: String(repoId(repo.toLowerCase())), repository_owner: repo.split("/")[0], repository_visibility: visibility, ref, event_name: "push" })
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
  if (url.pathname === "/_fixture/hold" && req.method === "POST") {
    HELD.set(url.searchParams.get("repo"), []);
    return json(200, { held: [...HELD.keys()] });
  }
  if (url.pathname === "/_fixture/release-hold" && req.method === "POST") {
    const waiting = HELD.get(url.searchParams.get("repo")) ?? [];
    HELD.delete(url.searchParams.get("repo"));
    for (const go of waiting) go();
    return json(200, { released: waiting.length });
  }
  if (url.pathname === "/_fixture/direct" && req.method === "POST") {
    DIRECT.add(url.searchParams.get("repo"));
    return json(200, { direct: [...DIRECT] });
  }
  if (url.pathname === "/_fixture/describe" && req.method === "POST") {
    const rel = repos.get(url.searchParams.get("repo"))?.tags[url.searchParams.get("tag")];
    if (!rel?.spec) return json(404, { message: "no such fixture release" });
    rel.spec.description = url.searchParams.get("description");
    rel.files.set("gizlet.toml", Buffer.from(gizletToml(rel.spec)));
    return json(200, rel.spec);
  }
  if (url.pathname === "/_fixture/release" && req.method === "POST") {
    const key = url.searchParams.get("repo");
    if (!repos.has(key)) return json(404, { message: "no such fixture repository" });
    addRelease(key, url.searchParams.get("version"), { targets: [["aarch64-unknown-linux-gnu", "lite"]] });
    return json(201, { latest: repos.get(key).latest });
  }
  if (url.pathname === "/_fixture/revoke" && req.method === "POST") {
    const login = url.searchParams.get("login");
    for (const [t, l] of userTokens) if (l === login) userTokens.delete(t);
    return json(200, { revoked: login });
  }
  if (url.pathname === "/_fixture/replace" && req.method === "POST") {
    const key = url.searchParams.get("repo");
    REPLACED.set(key, repoId(key) + 1);
    return json(200, { repo: key, id: repoId(key) });
  }
  if (url.pathname === "/_fixture/hide" && req.method === "POST") {
    const key = url.searchParams.get("repo");
    if (url.searchParams.get("hidden") === "0") HIDDEN.delete(key);
    else HIDDEN.add(key);
    return json(200, { repo: key, hidden: HIDDEN.has(key) });
  }
  if (url.pathname === "/_fixture/rename" && req.method === "POST") {
    const [from, to] = [url.searchParams.get("repo"), url.searchParams.get("to")];
    const id = repoId(from);
    repos.set(to, repos.get(from));
    REPLACED.set(to, id);
    REPLACED.set(from, id + 2);
    return json(200, { repo: to, id, reused: { repo: from, id: repoId(from) } });
  }

  // github.com/login/oauth: the OAuth app's authorize page and token exchange.
  if (url.pathname === "/login/oauth/authorize") {
    if (url.searchParams.get("client_id") !== OAUTH_CLIENT_ID) return send(400, "unknown client_id");
    const login = url.searchParams.get("fixture_login");
    if (!USERS[login]) {
      const links = Object.keys(USERS)
        .map((l) => `<li><a href="${url.pathname}${url.search}&amp;fixture_login=${l}">Sign in as ${l}</a></li>`)
        .join("");
      return send(200, `<!doctype html><meta charset="utf-8"><title>Fixture GitHub</title><h1>Authorize the Gizlet fixture app</h1><ul>${links}</ul>`, { "content-type": "text/html; charset=utf-8" });
    }
    const code = randomBytes(10).toString("hex");
    oauthCodes.set(code, login);
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return send(302, "", { location: back.href });
  }
  if (url.pathname === "/login/oauth/access_token" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const body = (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const [id, secret] = basic ? Buffer.from(basic, "base64").toString().split(":") : [body.client_id, body.client_secret];
    if (id !== OAUTH_CLIENT_ID || secret !== OAUTH_CLIENT_SECRET) return json(200, { error: "incorrect_client_credentials" });
    const login = oauthCodes.get(body.code);
    if (!login) return json(200, { error: "bad_verification_code" });
    oauthCodes.delete(body.code);
    const t = `gho_fixture${randomBytes(12).toString("hex")}`;
    userTokens.set(t, login);
    return json(200, { access_token: t, token_type: "bearer", scope: "read:org,read:user,user:email" });
  }

  // api.github.com as a user who signed in with the OAuth app sees it.
  const asUser = userTokens.get(/^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "");
  const userParts = parts[0] === "user" || (parts[0] === "repos" && /^Bearer gho_/i.test(req.headers.authorization ?? ""));
  if (userParts) {
    const u = USERS[asUser];
    if (!u) return json(401, { message: "Bad credentials" });
    const visible = [...repos.keys()].filter((key) => !key.startsWith("_") && !PRIVATE.has(key) && u.perm(key));
    const repoJson = (key) => {
      const [owner, name] = key.split("/");
      return { id: repoId(key), name, full_name: key, owner: { login: owner }, private: PRIVATE.has(key), permissions: permissions(u.perm(key)) };
    };
    const path = parts.join("/");
    if (path === "user") return json(200, { id: u.id, login: asUser, name: u.name, email: u.email, avatar_url: `https://avatars.githubusercontent.com/u/${u.id}?v=4` });
    if (path === "user/emails") return json(200, [{ email: u.email, primary: true, verified: true, visibility: "private" }]);
    if (path === "user/orgs") return json(200, u.orgs.map((login) => ({ login })));
    if (path === "user/repos") return json(200, (url.searchParams.get("page") ?? "1") === "1" ? visible.map(repoJson) : []);
    if (parts[0] === "repos" && parts.length === 3) {
      const key = `${parts[1]}/${parts[2]}`.toLowerCase();
      return visible.includes(key) ? json(200, repoJson(key)) : json(404, { message: "Not Found" });
    }
    return json(404, { message: "Not Found" });
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
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { permissions } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (permissions?.contents !== "read" || permissions.metadata !== "read" || Object.keys(permissions).length !== 2) {
      return json(422, { message: "The index must request only Contents and Metadata read permissions" });
    }
    const t = `ghs_fixture${randomBytes(12).toString("hex")}`;
    tokens.add(t);
    return json(201, { token: t, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  }
  if (url.pathname === "/app/installations") {
    if (!(await asApp())) return json(401, { message: "A JSON web token could not be decoded" });
    return json(200, [{ id: INSTALLATION }]);
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
    // Any token reads a public repository's metadata.
    if (rest.length === 0 && HIDDEN.has(key)) {
      hit(`gone:${key}`);
      return json(404, { message: "Not Found" });
    }
    if (rest.length === 0 && repo && !PRIVATE.has(key) && !INSTALLED.has(key)) return json(200, { id: repoId(key), name, owner: { login: owner }, private: false });
    if (!repo || !INSTALLED.has(key)) return json(404, { message: "Not Found" });
    if (rest[0] === "collaborators" && rest[2] === "permission" && rest.length === 3) {
      const role = USERS[rest[1]]?.perm(key);
      if (!role) return json(404, { message: "Not Found" });
      return json(200, { permission: { maintain: "write", push: "write", pull: "read" }[role] ?? role, role_name: { push: "write", pull: "read" }[role] ?? role });
    }
    hit(`api:${key}`);
    const release = (tag) => ({ tag_name: tag, assets: [...repo.tags[tag].ids].map(([n, assetId]) => ({ id: assetId, name: n })) });
    if (rest.length === 0) return json(200, { id: repoId(key), name, owner: { login: owner }, private: PRIVATE.has(key) });
    if (rest.join("/") === "releases/latest") {
      hit(`latest:${key}`);
      return repo.latest ? json(200, release(repo.latest)) : json(404, { message: "Not Found" });
    }
    if (rest[0] === "releases" && rest[1] === "tags" && rest.length === 3) return repo.tags[rest[2]] ? json(200, release(rest[2])) : json(404, { message: "Not Found" });
    if (rest[0] === "contents" && rest.length > 1) {
      hit(`contents:${key}`);
      const file = repo.tags[url.searchParams.get("ref")]?.files.get(rest.slice(1).join("/"));
      if (!file) return json(404, { message: "Not Found" });
      if (req.headers.accept !== "application/vnd.github.raw") return json(200, { type: "file", path: rest.slice(1).join("/"), size: file.length });
      return send(200, file, { "content-length": String(file.length), "content-type": "application/vnd.github.raw" });
    }
    if (rest[0] === "releases" && rest[1] === "assets" && rest.length === 3) {
      const a = assets_.get(Number(rest[2]));
      if (!a || a.repo !== key) return json(404, { message: "Not Found" });
      if (RELOCATED.has(key)) return send(301, "", { location: `${issuer}/repositories/${repoId(key)}/releases/assets/${rest[2]}` });
      return serveAsset(a, Number(rest[2]));
    }
    return json(404, { message: "Not Found" });
  }
  // A relocated repository's asset, by repository id; needs the token and the Accept header again.
  // Where a repository is now, by its id (GET /repositories/<id>), with any token.
  if (parts[0] === "repositories" && parts.length === 2) {
    if (!bearer || !tokens.has(bearer)) return json(401, { message: "Bad credentials" });
    const key = [...repos.keys()].find((k) => !k.startsWith("_") && !HIDDEN.has(k) && !PRIVATE.has(k) && repoId(k) === Number(parts[1]));
    if (!key) return json(404, { message: "Not Found" });
    const [owner, name] = key.split("/");
    return json(200, { id: repoId(key), name, full_name: key, owner: { login: owner }, private: false });
  }
  if (parts[0] === "repositories" && parts[2] === "releases" && parts[3] === "assets" && parts.length === 5) {
    if (!bearer || !tokens.has(bearer)) return json(401, { message: "Bad credentials" });
    const a = assets_.get(Number(parts[4]));
    if (!a || repoId(a.repo) !== Number(parts[1])) return json(404, { message: "Not Found" });
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
        const file = repo.tags[a.tag].assets.get(a.name);
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
    const file = repos.get(a.repo).tags[a.tag].assets.get(a.name);
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }

  // github.com and raw.githubusercontent.com: public repositories only.
  const [owner, name, ...rest] = parts;
  const key = `${owner}/${name}`.toLowerCase();
  const repo = PRIVATE.has(key) || HIDDEN.has(key) ? undefined : repos.get(key);
  if (!repo) return send(404, "Not Found");
  if (rest.join("/") === "releases/latest") {
    hit(`latest:${key}`);
    return send(302, "", { location: `https://github.com/${owner}/${name}/releases/tag/${repo.latest}` });
  }
  // github.com: release assets.
  if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4) {
    const file = repo.tags[rest[2]]?.assets.get(rest[3]);
    if (!file) return send(404, "Not Found");
    if (HELD.has(key)) await new Promise((go) => HELD.get(key).push(go));
    return send(200, file, { "content-length": String(file.length), "content-type": "application/octet-stream" });
  }
  // raw.githubusercontent.com: repository files at a tag.
  const file = repo.tags[rest[0]]?.files.get(rest.slice(1).join("/"));
  if (file) return send(200, file, { "content-length": String(file.length), "content-type": "text/plain; charset=utf-8" });
  send(404, "Not Found");
}).listen(port, "127.0.0.1", () => console.log(`fixture server on ${issuer}`));

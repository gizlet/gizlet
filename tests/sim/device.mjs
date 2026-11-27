// End-to-end simulation of the whole Gizlet loop, run by tests/run-local.sh after the Hurl
// suite. It plays three parts against the running Worker, as gizlet/os will:
//
//   developer  publishes a release from "GitHub Actions" (an OIDC token from the fixture server)
//   player     signs up on gizlet.io, confirms the email and approves the console's code at /device
//   console    signs in with the device flow, opens a share link, downloads the package in
//              two parts (a dropped connection, then a Range resume), verifies its sha256,
//              unpacks it and checks manifest.json and the entry executable
//
//   BASE=http://127.0.0.1:18787 FIXTURE=http://127.0.0.1:18788 SITE=http://gizlet.test node tests/sim/device.mjs
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://127.0.0.1:18787";
const FIXTURE = process.env.FIXTURE ?? "http://127.0.0.1:18788";
const SITE = process.env.SITE ?? "http://gizlet.test";
const REPO = "fixture-org/pocket-sim";
const TARGET = "aarch64-unknown-linux-gnu";
const TIER = "lite";

let step = 0;
const log = (who, msg) => console.log(`${String(++step).padStart(2)}. [${who}] ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A request to one of the Worker's hosts (the dev server picks the host from X-Gizlet-Host). */
async function call(method, path, { body, token, origin, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = `Bearer ${token}`;
  if (origin) h.origin = origin;
  return fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}
async function json(res, want) {
  const data = await res.json().catch(() => null);
  if (want !== undefined && res.status !== want) fail(`${res.url}: expected ${want}, got ${res.status} ${JSON.stringify(data)}`);
  return data;
}
/** Asset URLs as the dev server serves them. */
const local = (url) => {
  const u = new URL(url);
  return { path: u.pathname + u.search };
};

// --- developer ---------------------------------------------------------------------------------
const { value: oidc } = await fetch(`${FIXTURE}/token?repo=${REPO}&ref=refs/tags/v1.0.0`).then((r) => r.json());
const published = await json(await call("POST", "/api/v1/publish", { token: oidc, body: {} }), 202);
log("developer", `published ${published.repo} ${published.tag}; share link ${published.share_url}`);

let release;
for (let i = 0; i < 60; i++) {
  const status = new URL(published.status_url);
  release = await json(await call("GET", status.pathname), 200);
  if (release.status === "ready" || release.status === "failed") break;
  await sleep(250);
}
if (release.status !== "ready") fail(`release ended ${release.status}: ${release.error}`);
log("developer", `release is ready, visibility ${release.visibility}`);

// --- console asks for a code -------------------------------------------------------------------
const code = await json(await call("POST", "/api/v1/auth/device/code", { body: { client_id: "gizlet-os" } }), 200);
if (!code.verification_uri.startsWith(SITE)) fail(`verification_uri ${code.verification_uri} is not on ${SITE}`);
log("console", `shows "${code.user_code}" and ${code.verification_uri}; polls every ${code.interval} s`);

const grant = { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: "gizlet-os" };
const pending = await json(await call("POST", "/api/v1/auth/device/token", { body: grant }), 400);
if (pending.error !== "authorization_pending") fail(`expected authorization_pending, got ${JSON.stringify(pending)}`);

// --- player approves on a phone ----------------------------------------------------------------
const email = `sim-${Date.now()}@example.com`;
const signUp = await call("POST", "/api/v1/auth/sign-up/email", { origin: SITE, body: { email, password: "pocket computer 1", name: "Sim Player", callbackURL: "/login?verified=1&next=%2Fdevice" } });
await json(signUp, 200);
if (signUp.headers.get("set-auth-token")) fail("sign-up signed in before the email was confirmed");
log("player", `signed up as ${email}; no session until the email is confirmed`);

// The local Worker keeps account mail in an outbox instead of sending it.
const mail = await json(await call("GET", `/api/v1/dev/mail?to=${encodeURIComponent(email)}`), 200);
const link = mail.link ?? fail("the sign-up email has no link");
if (!link.startsWith(`${SITE}/api/v1/auth/verify-email?`)) fail(`the sign-up email links to ${link}`);
const verified = await call("GET", link.slice(SITE.length));
if (verified.status !== 302) fail(`opening the email link: ${verified.status}`);
const web = verified.headers.get("set-auth-token") ?? fail("the email link did not sign the player in");
log("player", `opened the link in "${mail.subject}" and is signed in`);

const claimed = await json(await call("GET", `/api/v1/auth/device?user_code=${encodeURIComponent(code.user_code)}`, { token: web }), 200);
if (claimed.client_id !== "gizlet-os") fail(`device request is for ${claimed.client_id}`);
await json(await call("POST", "/api/v1/auth/device/approve", { token: web, origin: SITE, body: { userCode: code.user_code } }), 200);
log("player", "approved the console");

// --- console signs in --------------------------------------------------------------------------
let device;
for (let i = 0; i < 6 && !device; i++) {
  await sleep(code.interval * 1000 + 300);
  const res = await call("POST", "/api/v1/auth/device/token", { body: grant });
  const data = await res.json();
  if (res.ok) device = data.access_token;
  else if (data.error !== "authorization_pending" && data.error !== "slow_down") fail(`token request: ${JSON.stringify(data)}`);
}
if (!device) fail("the console never got a token");
const me = await json(await call("GET", "/api/v1/me", { token: device }), 200);
if (me.user.email !== email) fail(`console is signed in as ${me.user.email}`);
log("console", `signed in as ${me.user.name} <${me.user.email}>`);

// --- console installs from the share link ------------------------------------------------------
const resolved = await json(await call("GET", `/api/v1/resolve?url=${encodeURIComponent(published.share_url)}`), 200);
const install = await json(await call("GET", `/api/v1/gizlets/${resolved.repo}/install?target=${TARGET}&tier=${TIER}`, { token: device }), 200);
const pkg = install.package;
log("console", `install ${install.name} ${install.version}: ${pkg.file}, ${pkg.size} bytes`);

const dl = local(pkg.url);
const half = Math.floor(pkg.size / 2);
const first = await call("GET", dl.path, { headers: { range: `bytes=0-${half - 1}` } });
if (first.status !== 206) fail(`first part: ${first.status}`);
const a = Buffer.from(await first.arrayBuffer());
log("console", `connection dropped after ${a.length} bytes; resuming`);
const rest = await call("GET", dl.path, { headers: { range: `bytes=${a.length}-` } });
if (rest.status !== 206) fail(`resume: ${rest.status}`);
const file = Buffer.concat([a, Buffer.from(await rest.arrayBuffer())]);
const sum = createHash("sha256").update(file).digest("hex");
if (file.length !== pkg.size || sum !== pkg.sha256) fail(`package is ${file.length} bytes with sha256 ${sum}, expected ${pkg.size} and ${pkg.sha256}`);
if (rest.headers.get("x-checksum-sha256") !== pkg.sha256) fail("X-Checksum-Sha256 does not match");
log("console", "downloaded and verified sha256");

// Unpack as the console would.
const files = unzip(file);
const manifest = JSON.parse(files.get("manifest.json").toString());
if (manifest.id !== install.id || manifest.version !== install.version || manifest.target !== TARGET || manifest.entry !== pkg.entry) {
  fail(`manifest.json says ${JSON.stringify(manifest)}`);
}
const exe = files.get(manifest.entry) ?? fail(`entry ${manifest.entry} is missing`);
if (exe.readUInt32BE(0) !== 0x7f454c46 || exe.readUInt16LE(18) !== 183) fail("entry is not an aarch64 ELF executable");
log("console", `unpacked ${files.size} files; entry "${manifest.entry}" is an aarch64 ELF`);

// --- console signs out -------------------------------------------------------------------------
await json(await call("POST", "/api/v1/auth/sign-out", { token: device, origin: SITE, body: {} }), 200);
await json(await call("GET", "/api/v1/me", { token: device }), 401);
await json(await call("GET", "/api/v1/me", { token: web }), 200);
log("console", "signed out; the phone's session is still signed in");
console.log("simulation passed");

/** Files of a zip archive (stored or deflate, no ZIP64). */
function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) fail("package is not a zip");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (!name.endsWith("/")) out.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

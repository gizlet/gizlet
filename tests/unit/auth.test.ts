import assert from "node:assert/strict";
import { test } from "node:test";

const g = globalThis as unknown as { location: URL };

async function nextPathFor(next: string): Promise<string> {
  g.location = new URL(`https://gizlet.io/login?next=${encodeURIComponent(next)}`);
  // @ts-expect-error: the browser module has no type declarations.
  const { nextPath } = (await import("../../public/static/auth.js")) as { nextPath: (fallback: string) => string };
  return nextPath("/account");
}

test("login return paths stay on this site", async () => {
  assert.equal(await nextPathFor("/device?user_code=ABCD"), "/device?user_code=ABCD");
  assert.equal(await nextPathFor("/a/../account#x"), "/account#x");
  for (const bad of ["//evil.example", "/\\evil.example", "/\\\\evil.example", "https://evil.example/", "javascript:alert(1)", "evil", "/\t/evil.example"]) {
    assert.equal(await nextPathFor(bad), "/account", JSON.stringify(bad));
  }
});

test("account mail needs the MAIL binding, except on local runs", async () => {
  const { authOptions } = await import("../../src/auth.ts");
  const env = { SITE_ORIGIN: "https://gizlet.io", API_ORIGIN: "https://api.gizlet.io", GITHUB_API: "https://api.github.com", BETTER_AUTH_SECRET: "x", MAIL_FROM: "Gizlet <hello@gizlet.io>" };
  const opts = (e: object) => authOptions({ ...env, ...e }, {} as never);
  for (const mail of [(o: ReturnType<typeof opts>) => o.emailAndPassword?.sendResetPassword, (o: ReturnType<typeof opts>) => o.emailVerification?.sendVerificationEmail]) {
    assert.equal(mail(opts({})), undefined);
    assert.equal(mail(opts({ DEV_HOST_OVERRIDE: "0" })), undefined);
    assert.equal(typeof mail(opts({ DEV_HOST_OVERRIDE: "1" })), "function");
    assert.equal(typeof mail(opts({ MAIL: { send: async () => ({}) } })), "function");
  }
  // Email accounts get no session before the address is confirmed, whatever the mail setup.
  assert.equal(opts({}).emailAndPassword?.requireEmailVerification, true);
});

test("account mail goes out through the binding, in the request's language", async () => {
  const { authOptions } = await import("../../src/auth.ts");
  const sent: unknown[] = [];
  const env = { SITE_ORIGIN: "https://gizlet.io", API_ORIGIN: "https://api.gizlet.io", GITHUB_API: "https://api.github.com", BETTER_AUTH_SECRET: "x", MAIL_FROM: "Gizlet <hello@gizlet.io>", MAIL: { send: async (m: unknown) => (sent.push(m), {}) } };
  const send = authOptions(env as never, {} as never).emailVerification!.sendVerificationEmail!;
  const user = { email: "Player@Example.com" } as never;
  await send({ user, url: "https://gizlet.io/v1/auth/verify-email?token=t", token: "t" }, new Request("https://gizlet.io/", { headers: { "accept-language": "ja, en;q=0.5" } }));
  await send({ user, url: "https://gizlet.io/v1/auth/verify-email?token=u", token: "u" }, new Request("https://gizlet.io/", { headers: { cookie: "lang=zh-CN", "accept-language": "ja" } }));
  const [ja, zh] = sent as { from: unknown; to: string; subject: string; text: string }[];
  assert.deepEqual(ja!.from, { name: "Gizlet", email: "hello@gizlet.io" });
  assert.equal(ja!.to, "Player@Example.com");
  assert.match(ja!.subject, /メールアドレス/);
  assert.match(ja!.text, /verify-email\?token=t/);
  assert.match(zh!.subject, /邮箱/);
});

test("sender addresses", async () => {
  const { parseAddress } = await import("../../src/auth.ts");
  assert.deepEqual(parseAddress("Gizlet <hello@gizlet.io>"), { name: "Gizlet", email: "hello@gizlet.io" });
  assert.deepEqual(parseAddress('"Gizlet Team" <hello@gizlet.io>'), { name: "Gizlet Team", email: "hello@gizlet.io" });
  assert.equal(parseAddress(" hello@gizlet.io "), "hello@gizlet.io");
});

test("mailed links follow listed mirrors only", async () => {
  const { linkOrigin, mirrorDomains } = await import("../../src/auth.ts");
  const env = { SITE_ORIGIN: "https://gizlet.io", MIRROR_ORIGINS: " gizlet.xyz, https://Gizlet.Example/ " };
  const via = (host?: string) => linkOrigin(env, new Request("https://gizlet.io/v1/auth/sign-up/email", { headers: host ? { "x-forwarded-host": host } : {} }));
  assert.deepEqual(mirrorDomains(env), ["gizlet.xyz", "gizlet.example"]);
  assert.equal(via(), "https://gizlet.io");
  assert.equal(via("gizlet.xyz"), "https://gizlet.xyz");
  assert.equal(via("API.gizlet.xyz"), "https://gizlet.xyz");
  assert.equal(via("www.gizlet.example"), "https://gizlet.example");
  for (const bad of ["evil.example", "gizlet.xyz.evil.example", "evilgizlet.xyz", "dl.evil.example", "x.gizlet.xyz"]) assert.equal(via(bad), "https://gizlet.io", bad);
  assert.equal(linkOrigin({ SITE_ORIGIN: "https://gizlet.io" }, new Request("https://gizlet.io/", { headers: { "x-forwarded-host": "gizlet.xyz" } })), "https://gizlet.io");
  assert.equal(linkOrigin(env, undefined), "https://gizlet.io");
});

test("the verification link moves to the mirror, token and all", async () => {
  const { authOptions } = await import("../../src/auth.ts");
  const sent: { text: string }[] = [];
  const env = { SITE_ORIGIN: "https://gizlet.io", API_ORIGIN: "https://api.gizlet.io", GITHUB_API: "https://api.github.com", BETTER_AUTH_SECRET: "x", MAIL_FROM: "Gizlet <hello@gizlet.io>", MIRROR_ORIGINS: "gizlet.xyz", MAIL: { send: async (m: { text: string }) => (sent.push(m), {}) } };
  const send = authOptions(env as never, {} as never).emailVerification!.sendVerificationEmail!;
  const url = "https://gizlet.io/v1/auth/verify-email?token=t&callbackURL=%2Flogin";
  await send({ user: { email: "p@example.com" } as never, url, token: "t" }, new Request("https://gizlet.io/", { headers: { "x-forwarded-host": "gizlet.xyz" } }));
  await send({ user: { email: "p@example.com" } as never, url, token: "t" }, new Request("https://gizlet.io/"));
  assert.match(sent[0]!.text, /https:\/\/gizlet\.xyz\/v1\/auth\/verify-email\?token=t&callbackURL=%2Flogin/);
  assert.doesNotMatch(sent[0]!.text, /gizlet\.io/);
  assert.match(sent[1]!.text, /https:\/\/gizlet\.io\/v1\/auth\/verify-email\?token=t/);
});

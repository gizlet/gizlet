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

test("password reset needs Postmark, except on local runs", async () => {
  const { authOptions } = await import("../../src/auth.ts");
  const env = { SITE_ORIGIN: "https://gizlet.io", API_ORIGIN: "https://api.gizlet.io", GITHUB_API: "https://api.github.com", BETTER_AUTH_SECRET: "x", MAIL_FROM: "Gizlet <hello@gizlet.io>" };
  const reset = (e: object) => authOptions({ ...env, ...e }, {} as never).emailAndPassword?.sendResetPassword;
  assert.equal(reset({}), undefined);
  assert.equal(reset({ DEV_HOST_OVERRIDE: "0" }), undefined);
  assert.equal(typeof reset({ DEV_HOST_OVERRIDE: "1" }), "function");
  assert.equal(typeof reset({ POSTMARK_TOKEN: "t" }), "function");
});

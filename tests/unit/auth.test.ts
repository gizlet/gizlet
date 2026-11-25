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

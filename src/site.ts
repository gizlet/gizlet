/**
 * gizlet.io: share pages and the account pages the sign-in flows need (sign in, approve a
 * device, account). Deliberately plain until the site is designed.
 */
import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { gizletDetail } from "./db";
import type { Env } from "./env";
import { ensureGizlet } from "./registry";
import { repoRef } from "./repo";

type App = { Bindings: Env };
export const site = new Hono<App>();

const csp = (env: Env) =>
  `default-src 'self'; img-src 'self' https: ${env.DL_ORIGIN}; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com`;

function page(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>, script?: string) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/site.css">
${script ? raw(`<script type="module" src="/static/${script}"></script>`) : ""}
</head>
<body>
<header><a class="brand" href="/">gizlet</a><nav><a href="/account">Account</a></nav></header>
<main>${body}</main>
<footer><a href="https://github.com/gizlet/gizlet">Source</a></footer>
</body>
</html>`;
}

site.use("*", async (c, next) => {
  await next();
  if ((c.res.headers.get("content-type") ?? "").startsWith("text/html")) {
    c.res.headers.set("content-security-policy", csp(c.env));
    c.res.headers.set("x-content-type-options", "nosniff");
    c.res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
});

site.get("/", (c) =>
  c.html(
    page(
      "Gizlet",
      html`<h1>Gizlet</h1>
<p>Turn a handheld into a pocket computer. A gizlet is one native Linux program or game: build it in Rust, Go, Zig, C or Flutter, release it on GitHub, and share its link with anyone. No review to install, no store tax.</p>
<p><a href="${c.env.API_ORIGIN}/v1">API</a> · <a href="https://github.com/gizlet/gizlet">Source</a></p>`,
    ),
  ),
);

site.get("/login", (c) =>
  c.html(
    page(
      "Sign in · Gizlet",
      html`<h1>Sign in</h1>
<form id="signin" class="card">
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" minlength="10" required></label>
  <label class="signup">Name <input name="name" autocomplete="name"></label>
  <button type="submit" data-mode="signin">Sign in</button>
  <button type="button" id="toggle" class="link">Create an account instead</button>
</form>
${c.env.GITHUB_CLIENT_ID ? html`<button id="github" class="card">Continue with GitHub</button>` : ""}
<p id="message" role="status"></p>`,
      "login.js",
    ),
  ),
);

site.get("/device", (c) =>
  c.html(
    page(
      "Connect a device · Gizlet",
      html`<h1>Connect a device</h1>
<p>Enter the code shown on your handheld.</p>
<form id="device" class="card">
  <label>Code <input name="user_code" value="${c.req.query("user_code") ?? ""}" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
  <button type="submit" name="action" value="approve">Allow</button>
  <button type="submit" name="action" value="deny" class="secondary">Deny</button>
</form>
<p id="message" role="status"></p>`,
      "device.js",
    ),
  ),
);

site.get("/account", (c) =>
  c.html(
    page(
      "Account · Gizlet",
      html`<h1>Account</h1>
<div id="account" class="card" hidden>
  <p><b id="name"></b><br><span id="email"></span></p>
  <p>Sign-in methods: <span id="methods"></span></p>
  <p>GitHub: <span id="github-login"></span></p>
  ${c.env.GITHUB_CLIENT_ID ? html`<button id="link-github" class="secondary">Link GitHub</button>` : ""}
  <button id="signout" class="secondary">Sign out</button>
</div>
<h2>Your gizlets</h2>
<ul id="gizlets"></ul>
<p id="message" role="status"></p>`,
      "account.js",
    ),
  ),
);

/** Share page: github.com/<owner>/<repo>. Opening it on a device installs the gizlet. */
site.get("/github.com/:owner/:repo", async (c) => {
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  if (!r) return c.html(page("Not found · Gizlet", html`<h1>Not a GitHub repository</h1>`), 404);
  const g = await ensureGizlet(c.env, r, c.executionCtx);
  if (!g) {
    return c.html(
      page("Not found · Gizlet", html`<h1>${r.key}</h1><p>This repository has no release with a <code>gizlet.json</code>.</p>`),
      404,
    );
  }
  if (g.visibility === "blocked") return c.html(page("Blocked · Gizlet", html`<h1>${g.name}</h1><p>This gizlet has been removed: ${g.visibility_reason ?? "it broke the rules"}.</p>`), 403);
  const d = await gizletDetail(c.env, g);
  return c.html(
    page(
      `${d.name} · Gizlet`,
      html`<article class="gizlet">
  ${d.icon_url ? html`<img class="icon" src="${d.icon_url}" alt="" width="96" height="96">` : ""}
  <h1>${d.name}</h1>
  <p>${d.description ?? ""}</p>
  <p class="meta">${d.version ? `Version ${d.version}` : ""} · <a href="${d.github_url}">${r.key}</a>${d.visibility === "unlisted" ? " · unlisted" : ""}</p>
  <h2>Install</h2>
  <p>On a Gizlet device, open this link to install it. Packages:</p>
  <ul>${d.packages.map((p) => html`<li><a href="${p.url}">${p.target}</a> (${p.tier}, ${Math.max(1, Math.round(p.size / 1024))} KiB)</li>`)}</ul>
</article>`,
    ),
  );
});

site.notFound((c) => c.html(page("Not found · Gizlet", html`<h1>Not found</h1>`), 404));

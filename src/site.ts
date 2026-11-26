/**
 * gizlet.io: the home page (src/home.ts), share pages and the account pages the sign-in flows
 * need (sign in, approve a device, account).
 */
import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { gizletDetail } from "./db";
import type { Env } from "./env";
import { homePage } from "./home";
import { ensureGizlet } from "./registry";
import { parseRepoAddress, repoRef } from "./repo";

type App = { Bindings: Env };
export const site = new Hono<App>();

const csp = (env: Env) =>
  `default-src 'self'; img-src 'self' https: ${env.DL_ORIGIN}; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com`;

const DESCRIPTION = "Gizlet turns handhelds into pocket computers: native Linux programs and games, released on GitHub and installed from their link.";

const brand = html`<a class="brand" href="/" aria-label="Gizlet home"><span class="px" aria-hidden="true">${raw("<i></i>".repeat(9))}</span>GIZLET</a>`;

/** `wide` pages (the home page) lay out their own `.wrap` containers; others get a narrow column. */
function page(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>, script?: string, wide = false) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="#f2ede4">
<link rel="stylesheet" href="/static/site.css">
${script ? raw(`<script type="module" src="/static/${script}"></script>`) : ""}
</head>
<body${wide ? raw(' class="home"') : ""}>
<header class="wrap">${brand}<nav><a href="/#gizlets">Gizlets</a><a href="/#make">Make</a><a href="https://github.com/gizlet/os">Gizlet OS</a></nav><a class="login" href="/account">Account</a></header>
<main>${wide ? body : html`<div class="wrap narrow">${body}</div>`}</main>
<footer><div class="wrap"><span>© 2026 Gizlet</span><a href="https://github.com/gizlet/gizlet">Source</a><a href="https://github.com/gizlet/os">Gizlet OS</a><a href="https://github.com/gizlet/gizlet/blob/main/LICENSE">Apache-2.0</a><span class="keys">Ⓐ Select · Ⓑ Back</span></div></footer>
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

site.get("/", async (c) => c.html(page("Gizlet · Native games and apps for handhelds", await homePage(c.env), undefined, true)));

/** The home page's "Got a link?" box: any way of writing a GitHub repository opens its share page. */
site.get("/open", async (c) => {
  const url = c.req.query("url") ?? "";
  const r = parseRepoAddress(url);
  if (r) return c.redirect(`/${r.key}`, 302);
  return c.html(page("Gizlet", await homePage(c.env, `"${url.slice(0, 200)}" is not a GitHub repository. Try github.com/owner/repo.`), undefined, true), 400);
});

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

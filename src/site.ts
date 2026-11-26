/**
 * gizlet.io: the home page (src/home.ts), gizlet pages (src/gizlet-page.ts) and the account pages the sign-in flows
 * need (sign in, approve a device, account), in every language of src/i18n.ts.
 */
import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { dlUrl, gizletDetail } from "./db";
import type { Env } from "./env";
import { devicePage, devicesPage, flashScript } from "./devices";
import { explorePage } from "./explore";
import { gizletPage } from "./gizlet-page";
import { MAX_THEMES, patternHref, patternRule, THEME_FILE, THEME_VERSION, themeCss, themeHref } from "./theme";
import { homePage } from "./home";
import { mark } from "./mark";
import { DEFAULT_LOCALE, LOCALE_NAMES, LOCALES, localized, matchLocale, MESSAGES, requestLocale, rich, scriptMessages, type Locale, type Messages } from "./i18n";
import { ensureGizlet } from "./registry";
import { parseRepoAddress, repoRef } from "./repo";

type App = { Bindings: Env; Variables: { lang: Locale } };
type C = Context<App>;
export const site = new Hono<App>();

const csp = (env: Env) =>
  `default-src 'self'; img-src 'self' https: ${env.DL_ORIGIN}; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com`;

const LANG_COOKIE = "lang";

/** The language from `?lang=`, the `lang` cookie, then Accept-Language. */
function pickLocale(c: C): { lang: Locale; chosen: boolean } {
  const fromQuery = matchLocale(c.req.query("lang"));
  if (fromQuery) return { lang: fromQuery, chosen: true };
  return { lang: requestLocale(c.req.raw.headers), chosen: false };
}

const langOf = (c: C): Locale => c.get("lang") ?? DEFAULT_LOCALE;
const tr = (c: C): Messages => MESSAGES[langOf(c)];

/** This page in another language: the same path and query, with `lang` set. */
function langHref(c: C, lang: Locale): string {
  const q = new URL(c.req.url).searchParams;
  q.set("lang", lang);
  return `?${q}`;
}

const navLink = (c: C, path: string, text: string) =>
  html`<a href="${path}"${c.req.path === path || (path !== "/" && c.req.path.startsWith(`${path}/`)) ? raw(' aria-current="page"') : ""}>${text}</a>`;

interface PageOptions {
  script?: string;
  /** Extra stylesheets from this site. */
  styles?: string[];
  /** Pages that lay out their own `.wrap` containers (the home page); others get a narrow column. */
  wide?: boolean;
}

function page(c: C, title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>, { script, styles = [], wide = false }: PageOptions = {}) {
  const lang = langOf(c);
  const t = MESSAGES[lang];
  const here = `${c.env.SITE_ORIGIN}${c.req.path}`;
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${t.meta.description}">
<meta name="theme-color" content="#eceef1">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
${lang === "en" ? raw('<link rel="preload" href="/static/fonts/schibsted-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>') : ""}
${LOCALES.map((l) => html`<link rel="alternate" hreflang="${l}" href="${here}?lang=${l}">\n`)}<link rel="alternate" hreflang="x-default" href="${here}">
<link rel="stylesheet" href="/static/site.css">
${styles.map((s) => html`<link rel="stylesheet" href="${s}">\n`)}${script ? html`${scriptMessages(t)}\n${raw(`<script type="module" src="/static/${script}"></script>`)}` : ""}
</head>
<body${wide ? raw(' class="home"') : ""}>
<header class="wrap"><a class="brand" href="/" aria-label="${t.nav.brand}">${mark}Gizlet</a><nav>${navLink(c, "/", t.nav.home)}${navLink(c, "/explore", t.nav.explore)}${navLink(c, "/install", t.nav.devices)}</nav><a class="login" href="/account">${t.nav.account}</a></header>
<main>${wide ? body : html`<div class="wrap narrow">${body}</div>`}</main>
<footer><div class="wrap">
  <span class="brand small">${mark}Gizlet</span><a href="https://github.com/gizlet/gizlet">${t.footer.source}</a><a href="https://github.com/gizlet/os">${t.footer.os}</a><a href="https://github.com/gizlet/gizlet/blob/main/LICENSE">Apache-2.0</a>
  <nav class="langs" aria-label="${t.footer.language}">${LOCALES.map((l) => html`<a href="${langHref(c, l)}" hreflang="${l}" lang="${l}"${l === lang ? raw(' aria-current="true"') : ""}>${LOCALE_NAMES[l]}</a>`)}</nav>
</div></footer>
</body>
</html>`;
}

site.use("*", async (c, next) => {
  const { lang, chosen } = pickLocale(c);
  c.set("lang", lang);
  await next();
  if ((c.res.headers.get("content-type") ?? "").startsWith("text/html")) {
    c.res.headers.set("content-security-policy", csp(c.env));
    c.res.headers.set("x-content-type-options", "nosniff");
    c.res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    c.res.headers.set("content-language", lang);
    c.res.headers.append("vary", "Accept-Language, Cookie");
  }
  if (chosen) {
    const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
    c.res.headers.append("set-cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`);
  }
});

site.get("/", async (c) => c.html(page(c, tr(c).meta.title, await homePage(c.env, langOf(c)), { wide: true })));

/** The home page's "Got a link?" box: any way of writing a GitHub repository opens its share page. */
site.get("/open", async (c) => {
  const url = c.req.query("url") ?? "";
  const r = parseRepoAddress(url);
  if (r) return c.redirect(`/${r.key}`, 302);
  return c.html(page(c, tr(c).meta.title, await homePage(c.env, langOf(c), url), { wide: true }), 400);
});

site.get("/explore", async (c) =>
  c.html(page(c, `${tr(c).explore.title} · Gizlet`, await explorePage(c.env, langOf(c), { q: c.req.query("q"), category: c.req.query("category"), cursor: c.req.query("cursor") }), { wide: true })),
);

/** The page was called Devices first; keep old links working. */
site.get("/devices", (c) => c.redirect(`/install${new URL(c.req.url).search}`, 301));
site.get("/devices/:id", (c) => c.redirect(`/install/${encodeURIComponent(c.req.param("id"))}`, 301));

site.get("/install", (c) =>
  c.html(page(c, `${tr(c).devices.title} · Gizlet`, devicesPage(langOf(c), { q: c.req.query("q"), status: c.req.query("status") }), { wide: true, script: "devices.js" })),
);

site.get("/install/:id", (c) => {
  const d = devicePage(langOf(c), c.req.param("id"), c.env.SITE_ORIGIN);
  if (!d) return c.notFound();
  return c.html(page(c, `${d.name} · ${tr(c).devices.title} · Gizlet`, d.body, { wide: true, script: "devices.js" }));
});

/** The writer for a supported handheld: `curl -fsSL gizlet.io/flash/r36s | bash`, or `/flash/r36s.ps1` for Windows. */
site.get("/flash/:name", (c) => {
  const to = flashScript(c.req.param("name"));
  if (!to) return c.text("no such handheld\n", 404);
  return c.redirect(to, 302);
});

site.get("/login", (c) => {
  const t = tr(c).login;
  return c.html(
    page(
      c,
      `${t.title} · Gizlet`,
      html`<h1>${t.title}</h1>
<form id="signin" class="card">
  <label>${t.email} <input name="email" type="email" autocomplete="email" required></label>
  <label>${t.password} <input name="password" type="password" autocomplete="current-password" minlength="10" required></label>
  <label class="signup">${t.name} <input name="name" autocomplete="name"></label>
  <button type="submit" data-mode="signin">${t.submit}</button>
  <button type="button" id="toggle" class="link">${t.toggle}</button>
</form>
${c.env.GITHUB_CLIENT_ID ? html`<button id="github" class="card">${t.github}</button>` : ""}
<p id="message" role="status"></p>`,
      { script: "login.js" },
    ),
  );
});

site.get("/device", (c) => {
  const t = tr(c).device;
  return c.html(
    page(
      c,
      `${t.title} · Gizlet`,
      html`<h1>${t.title}</h1>
<p>${t.text}</p>
<form id="device" class="card">
  <label>${t.code} <input name="user_code" value="${c.req.query("user_code") ?? ""}" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
  <button type="submit" name="action" value="approve">${t.allow}</button>
  <button type="submit" name="action" value="deny" class="secondary">${t.deny}</button>
</form>
<p id="message" role="status"></p>`,
      { script: "device.js" },
    ),
  );
});

site.get("/account", (c) => {
  const t = tr(c).account;
  return c.html(
    page(
      c,
      `${t.title} · Gizlet`,
      html`<h1>${t.title}</h1>
<div id="account" class="card" hidden>
  <p><b id="name"></b><br><span id="email"></span></p>
  <p>${t.methods} <span id="methods"></span></p>
  <p>${t.github} <span id="github-login"></span></p>
  ${c.env.GITHUB_CLIENT_ID ? html`<button id="link-github" class="secondary">${t.link}</button>` : ""}
  <button id="signout" class="secondary">${t.signOut}</button>
</div>
<h2>${t.gizlets}</h2>
<ul id="gizlets"></ul>
<p id="message" role="status"></p>`,
      { script: "account.js" },
    ),
  );
});

/** Share page: github.com/<owner>/<repo>. Opening it on a device installs the gizlet. */
site.get("/github.com/:owner/:repo", async (c) => {
  const lang = langOf(c);
  const t = tr(c).share;
  const notFound = `${t.notFound} · Gizlet`;
  const r = repoRef(c.req.param("owner"), c.req.param("repo"));
  if (!r) return c.html(page(c, notFound, html`<h1>${t.notRepo}</h1>`), 404);
  const g = await ensureGizlet(c.env, r, c.executionCtx);
  if (!g) return c.html(page(c, notFound, html`<h1>${r.key}</h1><p>${rich(t.noIndex)}</p>`), 404);
  if (g.visibility === "blocked") {
    return c.html(page(c, `${t.blocked} · Gizlet`, html`<h1>${g.name}</h1><p>${t.removed(g.visibility_reason ?? t.brokeRules)}</p>`), 403);
  }
  const d = await gizletDetail(c.env, g);
  const name = localized(d.names, d.name, lang);
  const href = themeHref([d.color]);
  const styles = [href, patternHref([d])].filter((s): s is string => !!s);
  return c.html(page(c, `${name} · Gizlet`, await gizletPage(c.env, g, d, lang), { wide: true, styles, script: "devices.js" }));
});

/** Pattern tiles (gizlet.toml `pattern`) of the gizlets a page shows: ?r=github.com/<owner>/<repo>, repeated (src/theme.ts). */
site.get("/_patterns.css", async (c) => {
  const repos = [...new Set(c.req.queries("r") ?? [])].filter((r) => /^github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(r)).slice(0, MAX_THEMES);
  if (!repos.length) return c.notFound();
  const { results } = await c.env.DB.prepare(
    `SELECT repo, latest_tag, pattern FROM gizlets WHERE repo IN (${repos.map(() => "?").join(", ")}) AND visibility != 'blocked' AND pattern IS NOT NULL AND latest_tag IS NOT NULL`,
  )
    .bind(...repos)
    .all<{ repo: string; latest_tag: string; pattern: string }>();
  const css = results.map((g) => patternRule(g.repo, dlUrl(c.env, g.repo, g.latest_tag, g.pattern))).join("");
  return c.body(css, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" });
});

/** Gizlets' own colours (gizlet.toml `color`), as a stylesheet: the CSP allows no inline styles (src/theme.ts). */
site.get("/_theme/:version/:file", (c) => {
  const m = THEME_FILE.exec(c.req.param("file"));
  if (!m || c.req.param("version") !== THEME_VERSION) return c.notFound();
  return c.body(themeCss(m[1]!.split("-")), 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" });
});

site.notFound((c) => {
  const t = tr(c).share;
  return c.html(page(c, `${t.notFound} · Gizlet`, html`<h1>${t.notFound}</h1>`), 404);
});

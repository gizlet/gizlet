/**
 * The gizlet.io home page, in the "cartridge" direction (design/cartridge.html): what Gizlet is,
 * the listed gizlets as cartridges, and how a developer publishes one.
 */
import { html } from "hono/html";
import { featured, summary } from "./db";
import type { Env } from "./env";
import { heroTitle, localized, MESSAGES, rich, type Locale, type Messages } from "./i18n";

type Summary = ReturnType<typeof summary>;

const PATTERNS = 5;
/** A stable label pattern for a gizlet without art. Inline styles are blocked by the CSP. */
function pattern(repo: string): string {
  let h = 0;
  for (const ch of repo) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `p${(h % PATTERNS) + 1}`;
}

const host = (origin: string) => origin.replace(/^[a-z]+:\/\//i, "");
const nameOf = (g: Summary, lang: Locale) => localized(g.names, g.name, lang);

function label(g: Summary, big = false) {
  const art = big ? (g.cover_url ?? g.icon_url) : (g.icon_url ?? g.cover_url);
  return art
    ? html`<img class="pic" src="${art}" alt="" loading="lazy" decoding="async">`
    : html`<div class="pic ${pattern(g.repo)}"></div>`;
}

function cart(g: Summary, t: Messages, lang: Locale) {
  return html`<a class="cart" href="/${g.repo}">
  <div class="label">${label(g)}<div class="txt"><div class="no">${g.repo.replace(/^github\.com\//, "")}</div><h3>${nameOf(g, lang)}</h3></div></div>
  <div class="foot"><span>${t.home.category[g.category ?? ""] ?? t.home.category.app}</span>${g.version ? html`<span class="tag">v${g.version}</span>` : ""}</div>
</a>`;
}

const ticker = (t: Messages) =>
  html`<div class="ticker" aria-hidden="true"><div class="run">${[0, 1].map(() => t.home.facts.map((f) => html`<span><b>★</b> ${f}</span>`))}</div></div>`;

export async function homePage(env: Env, lang: Locale, badUrl?: string) {
  const t = MESSAGES[lang];
  const { hero, sections: all } = await featured(env);
  // The automatic sections overlap; while the shelf is small, skip one that would only repeat carts.
  const shown = new Set<string>();
  const sections = all.filter((s) => {
    const fresh = s.gizlets.slice(0, 8).some((g) => !shown.has(g.repo));
    for (const g of s.gizlets.slice(0, 8)) shown.add(g.repo);
    return fresh;
  });
  // Automatic sections by id; hand-picked collections by their own titles.
  const title = (s: (typeof all)[number]) => t.home.sections[s.id] ?? localized(s.titles, s.title, lang);
  const star = hero[0];
  const site = host(env.SITE_ORIGIN);
  return html`<div class="wrap">
<section class="hero">
  <div class="copy">
    <span class="stamp">${t.home.stamp}</span>
    <h1>${heroTitle(t)}</h1>
    <p>${t.home.lede}</p>
    <div class="btns"><a class="btn go" href="#gizlets">${t.home.browse}</a><a class="btn" href="#make">${t.home.make}</a></div>
  </div>
  <div class="art">
    ${star
      ? html`<a class="bigcart" href="/${star.repo}" title="${nameOf(star, lang)}"><div class="label">${label(star, true)}</div><div class="ribs"></div></a>
    <a class="caption" href="/${star.repo}">${t.home.featured(nameOf(star, lang))}</a>`
      : html`<div class="bigcart"><div class="label"><div class="pic p1"></div></div><div class="ribs"></div></div>`}
  </div>
</section>

<form class="open" action="/open" method="get">
  <label for="open-url">${t.home.openLabel}</label>
  <input id="open-url" name="url" placeholder="github.com/owner/repo" autocomplete="off" autocapitalize="off" spellcheck="false" required>
  <button type="submit" class="btn">${t.home.openButton}</button>
  ${badUrl !== undefined ? html`<p class="error" role="alert">${t.home.openError(badUrl.slice(0, 200))}</p>` : ""}
</form>

<section id="gizlets" class="shelf">
  ${sections.length
    ? sections.map(
        (s) => html`<div class="row-head"><h2>${title(s)}</h2></div>
  <div class="carts">${s.gizlets.slice(0, 8).map((g) => cart(g, t, lang))}</div>`,
      )
    : html`<div class="row-head"><h2>${t.home.emptyTitle}</h2></div>
  <div class="empty"><p>${t.home.emptyText}</p><a class="btn" href="#make">${t.home.emptyButton}</a></div>`}
</section>
</div>

${ticker(t)}

<div class="wrap">
<section id="how" class="how">
  <div class="row-head"><h2>${t.home.howTitle}</h2></div>
  <ol class="steps">
    ${t.home.steps.map((s, i) => html`<li><span class="num">0${i + 1}</span><h3>${s.title}</h3><p>${rich(s.text(site))}</p></li>`)}
  </ol>
</section>

<section id="make" class="make">
  <div class="copy">
    <span class="stamp">${t.home.devStamp}</span>
    <h2>${t.home.devTitle}</h2>
    <p>${t.home.devText}</p>
    <div class="btns"><a class="btn go" href="https://github.com/gizlet/gizlet#api">${t.home.docs}</a><a class="btn" href="${env.API_ORIGIN}/v1">${t.home.api}</a></div>
  </div>
  <pre class="code"><code><span class="c">${t.home.codeComment}</span>
permissions:
  id-token: write
steps:
  - name: Publish to Gizlet
    run: |
      token=$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
        "$ACTIONS_ID_TOKEN_REQUEST_URL&amp;audience=${env.OIDC_AUDIENCE}" | jq -r .value)
      curl -fsS -X POST -H "Authorization: Bearer $token" \\
        ${env.API_ORIGIN}/v1/publish</code></pre>
</section>

<section class="pillars">
  ${t.home.pillars.map((p) => html`<div><h3>${p.title}</h3><p>${rich(p.text)}</p></div>`)}
</section>
</div>`;
}

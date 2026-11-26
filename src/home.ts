/**
 * The gizlet.io home page: a cartridge going into a handheld, the address box, the listed
 * gizlets as cartridges, how a gizlet gets made, and the template for developers.
 * design/README.md describes the look.
 */
import { html } from "hono/html";
import { featured, summary } from "./db";
import { bootScreen, handheld } from "./devices";
import type { Env } from "./env";
import { heroTitle, localized, MESSAGES, rich, type Locale, type Messages } from "./i18n";

/** Where share pages live. */
export const STORE_HOST = "store.gizlet.io";

type Summary = ReturnType<typeof summary>;

function hash(s: string, seed: number): number {
  let h = seed;
  for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}
/** Label art for a gizlet without an icon, and the colour of its plastic shell; both stable per repository. Inline styles are blocked by the CSP, so these are classes. */
const pattern = (repo: string) => `p${(hash(repo, 7) % 5) + 1}`;
export const shell = (repo: string) => `s${(hash(repo, 3) % 5) + 1}`;

const nameOf = (g: Summary, lang: Locale) => localized(g.names, g.name, lang);

export function art(g: Summary, big = false) {
  const src = big ? (g.cover_url ?? g.icon_url) : (g.icon_url ?? g.cover_url);
  return src ? html`<img class="pic" src="${src}" alt="" loading="lazy" decoding="async">` : html`<span class="pic ${pattern(g.repo)}"></span>`;
}

export function cart(g: Summary, t: Messages, lang: Locale) {
  return html`<a class="cart ${shell(g.repo)}" href="/${g.repo}">
  <span class="grip" aria-hidden="true"></span>
  <span class="label">${art(g)}</span>
  <span class="name">${nameOf(g, lang)}</span>
  <span class="repo">${g.repo.replace(/^github\.com\//, "")}</span>
  <span class="meta"><span>${t.home.category[g.category ?? ""] ?? t.home.category.app}</span>${g.version ? html`<span>v${g.version}</span>` : ""}</span>
</a>`;
}

const ticker = (t: Messages) =>
  html`<div class="ticker" aria-hidden="true"><div class="run">${[0, 1].map(() => t.home.facts.map((f) => html`<span>${f}</span><i></i>`))}</div></div>`;

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
  const screen = star ? html`<span class="now">${art(star, true)}<b>${nameOf(star, lang)}</b></span>` : bootScreen;
  return html`<section class="stage">
  <div class="wrap stage-grid">
    <div class="copy">
      <p class="kicker">${t.home.stamp}</p>
      <h1 class="display">${heroTitle(t)}</h1>
      <p class="lede">${t.home.lede}</p>
      <form class="open" action="/open" method="get">
        <label for="open-url">${t.home.openLabel}</label>
        <div class="addr">
          <span class="prefix" aria-hidden="true">${STORE_HOST}/</span>
          <input id="open-url" name="url" placeholder="github.com/owner/repo" autocomplete="off" autocapitalize="off" spellcheck="false" required>
          <button type="submit">${t.home.openButton}</button>
        </div>
        ${badUrl !== undefined ? html`<p class="error" role="alert">${t.home.openError(badUrl.slice(0, 200))}</p>` : ""}
      </form>
      <div class="btns"><a class="btn sun" href="/explore">${t.home.browse}</a><a class="btn ghost" href="#make">${t.home.make}</a></div>
    </div>
    <div class="rig">
      ${star
        ? html`<a class="rig-cart cart ${shell(star.repo)}" href="/${star.repo}" tabindex="-1" aria-hidden="true"><span class="grip"></span><span class="label">${art(star)}</span></a>`
        : html`<span class="rig-cart cart s1" aria-hidden="true"><span class="grip"></span><span class="label"><span class="pic p1"></span></span></span>`}
      ${handheld(screen, "body-sun", "big")}
      ${star ? html`<a class="caption" href="/${star.repo}">${t.home.featured(nameOf(star, lang))}</a>` : ""}
    </div>
  </div>
</section>

${ticker(t)}

<section id="gizlets" class="wrap shelf">
  ${sections.length
    ? sections.map(
        (s) => html`<div class="row-head"><h2>${title(s)}</h2><a href="/explore">${t.home.seeAll}</a></div>
  <div class="carts">${s.gizlets.slice(0, 8).map((g) => cart(g, t, lang))}</div>`,
      )
    : html`<div class="row-head"><h2>${t.home.emptyTitle}</h2></div>
  <div class="empty"><span class="cart ghost-cart" aria-hidden="true"><span class="grip"></span><span class="label"></span></span><p>${t.home.emptyText}</p><a class="btn" href="#make">${t.home.emptyButton}</a></div>`}
</section>

<section id="how" class="wrap how">
  <div class="row-head"><h2>${t.home.howTitle}</h2></div>
  <ol class="scenes">
    <li>
      <div class="scene scene-chat"><div class="chat"><p class="you">${t.home.prompt}</p><p class="agent"><span>✓</span> gizlet skill<br><span>✓</span> snake/ ← gizlet/template<br><span>✓</span> linux-arm64 · linux-x64<br><span>✓</span> macos · windows</p></div></div>
      <div class="step"><span class="num">1</span><div><h3>${t.home.steps[0]!.title}</h3><p>${rich(t.home.steps[0]!.text(STORE_HOST))}</p></div></div>
    </li>
    <li>
      <div class="scene scene-term"><pre class="term"><span class="p">$</span> git tag v1.0.0
<span class="p">$</span> git push --tags
<span class="ok">✓</span> release v1.0.0
<span class="ok">✓</span> ${STORE_HOST}</pre></div>
      <div class="step"><span class="num">2</span><div><h3>${t.home.steps[1]!.title}</h3><p>${rich(t.home.steps[1]!.text(STORE_HOST))}</p></div></div>
    </li>
    <li>
      <div class="scene scene-device">${handheld(html`<span class="installing"><span class="url">${STORE_HOST}/github.com/you/snake</span><b>${t.home.installing}</b><span class="bar"><i></i></span></span>`, "body-coral", "small")}</div>
      <div class="step"><span class="num">3</span><div><h3>${t.home.steps[2]!.title}</h3><p>${rich(t.home.steps[2]!.text(STORE_HOST))}</p></div></div>
    </li>
  </ol>
</section>

<section id="make" class="make">
  <div class="wrap make-grid">
    <div class="copy">
      <p class="kicker">${t.home.devStamp}</p>
      <h2 class="display">${t.home.devTitle}</h2>
      <p>${rich(t.home.devText)}</p>
      <div class="btns"><a class="btn sun" href="https://github.com/gizlet/template/generate">${t.home.template}</a><a class="btn ghost" href="https://github.com/gizlet/skills">${t.home.skill}</a></div>
    </div>
    <figure class="tree">
      <figcaption>${t.home.treeCaption}</figcaption>
      <pre class="code"><code><b>snake/</b>
├── .github/workflows/release.yml  <span class="c"># ${t.home.tree.workflow}</span>
├── gizlet.json                    <span class="c"># ${t.home.tree.index}</span>
├── assets/icon.png                <span class="c"># ${t.home.tree.icon}</span>
└── src/                           <span class="c"># ${t.home.tree.source}</span></code></pre>
    </figure>
  </div>
</section>

<section class="wrap pillars">
  ${t.home.pillars.map((p) => html`<div><h3>${p.title}</h3><p>${rich(p.text)}</p></div>`)}
</section>`;
}

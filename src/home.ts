/**
 * The gizlet.io home page, in the "cartridge" direction (design/cartridge.html): what Gizlet is,
 * the listed gizlets as cartridges, and how a developer publishes one.
 */
import { html } from "hono/html";
import { featured, summary } from "./db";
import type { Env } from "./env";

type Summary = ReturnType<typeof summary>;

const PATTERNS = 5;
/** A stable label pattern for a gizlet without art. Inline styles are blocked by the CSP. */
function pattern(repo: string): string {
  let h = 0;
  for (const ch of repo) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `p${(h % PATTERNS) + 1}`;
}

const CATEGORY: Record<string, string> = { game: "Game", app: "App" };
const host = (origin: string) => origin.replace(/^[a-z]+:\/\//i, "");

function label(g: Summary, big = false) {
  const art = big ? (g.cover_url ?? g.icon_url) : (g.icon_url ?? g.cover_url);
  return art
    ? html`<img class="pic" src="${art}" alt="" loading="lazy" decoding="async">`
    : html`<div class="pic ${pattern(g.repo)}"></div>`;
}

function cart(g: Summary) {
  return html`<a class="cart" href="/${g.repo}">
  <div class="label">${label(g)}<div class="txt"><div class="no">${g.repo.replace(/^github\.com\//, "")}</div><h3>${g.name}</h3></div></div>
  <div class="foot"><span>${CATEGORY[g.category ?? ""] ?? "App"}</span>${g.version ? html`<span class="tag">v${g.version}</span>` : ""}</div>
</a>`;
}

const FACTS = ["No review to install", "No store tax", "Open source, Apache-2.0", "Rust · Go · Zig · C · Flutter", "Installs from a GitHub link"];
const ticker = () => html`<div class="ticker" aria-hidden="true"><div class="run">${[0, 1].map(() => FACTS.map((f) => html`<span><b>★</b> ${f}</span>`))}</div></div>`;

export async function homePage(env: Env, repoError?: string) {
  const { hero, sections: all } = await featured(env);
  // The automatic sections overlap; while the shelf is small, skip one that would only repeat carts.
  const shown = new Set<string>();
  const sections = all.filter((s) => {
    const fresh = s.gizlets.slice(0, 8).some((g) => !shown.has(g.repo));
    for (const g of s.gizlets.slice(0, 8)) shown.add(g.repo);
    return fresh;
  });
  const star = hero[0];
  const site = host(env.SITE_ORIGIN);
  return html`<div class="wrap">
<section class="hero">
  <div class="copy">
    <span class="stamp">Open · No store tax</span>
    <h1>One link.<br>One press.<br><em>Pocket</em> it.</h1>
    <p>Gizlet turns handhelds into pocket computers. Every gizlet is one native Linux program or game, released on GitHub and installed straight from its link.</p>
    <div class="btns"><a class="btn go" href="#gizlets">Browse gizlets ▶</a><a class="btn" href="#make">Make a gizlet</a></div>
  </div>
  <div class="art">
    ${star
      ? html`<a class="bigcart" href="/${star.repo}" title="${star.name}"><div class="label">${label(star, true)}</div><div class="ribs"></div></a>
    <a class="caption" href="/${star.repo}">Featured · ${star.name}</a>`
      : html`<div class="bigcart"><div class="label"><div class="pic p1"></div></div><div class="ribs"></div></div>`}
  </div>
</section>

<form class="open" action="/open" method="get">
  <label for="open-url">Got a link?</label>
  <input id="open-url" name="url" placeholder="github.com/owner/repo" autocomplete="off" autocapitalize="off" spellcheck="false" required>
  <button type="submit" class="btn">Open</button>
  ${repoError ? html`<p class="error" role="alert">${repoError}</p>` : ""}
</form>

<section id="gizlets" class="shelf">
  ${sections.length
    ? sections.map(
        (s) => html`<div class="row-head"><h2>${s.title}</h2></div>
  <div class="carts">${s.gizlets.slice(0, 8).map(cart)}</div>`,
      )
    : html`<div class="row-head"><h2>Fresh carts</h2></div>
  <div class="empty"><p>Nothing on the shelf yet. The first gizlets appear here once they are published and pass their checks.</p><a class="btn" href="#make">Publish the first one</a></div>`}
</section>
</div>

${ticker()}

<div class="wrap">
<section id="how" class="how">
  <div class="row-head"><h2>How it works</h2></div>
  <ol class="steps">
    <li><span class="num">01</span><h3>Build</h3><p>Write it in Rust, Go, Zig, C, Flutter or anything that makes a native executable, with raylib, Slint or any UI engine.</p></li>
    <li><span class="num">02</span><h3>Release</h3><p>Attach a <code>gizlet.json</code> and your <code>.gzl</code> packages to a GitHub release. Your workflow tells Gizlet, and the packages are mirrored and checked.</p></li>
    <li><span class="num">03</span><h3>Share</h3><p>Send <code>${site}/github.com/you/game</code>. Open it on a handheld and it installs. No review, no waiting.</p></li>
  </ol>
</section>

<section id="make" class="make">
  <div class="copy">
    <span class="stamp">For developers</span>
    <h2>Publish from GitHub Actions</h2>
    <p>No account and no API key. Gizlet trusts the workflow's OIDC token, so the repository proves who it is. Search and the featured lists show gizlets that pass the automated checks; installing by link works for any gizlet that is not blocked.</p>
    <div class="btns"><a class="btn go" href="https://github.com/gizlet/gizlet#api">Read the docs</a><a class="btn" href="${env.API_ORIGIN}/v1">API</a></div>
  </div>
  <pre class="code"><code><span class="c"># .github/workflows/release.yml, after the release assets are up</span>
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
  <div><h3>No review to install</h3><p>Anyone with the link can install a gizlet, like a Go module or an npm package.</p></div>
  <div><h3>No store tax</h3><p>Developers will sell software and services through the platform directly.</p></div>
  <div><h3>Open</h3><p>Registry, downloads and accounts are <a href="https://github.com/gizlet/gizlet">one open repository</a>. The handheld OS is <a href="https://github.com/gizlet/os">gizlet/os</a>.</p></div>
</section>
</div>`;
}

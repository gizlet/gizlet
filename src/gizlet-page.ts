/**
 * A gizlet's page, store.gizlet.io/github.com/<owner>/<repo>: a band in the gizlet's own colour
 * with its cartridge going into a handheld, the link to install it, screenshots, the about page
 * from its repository, its controls and details. Everything comes from the Worker and the
 * download host, so the page works the same through a mirror that cannot reach GitHub.
 * design/README.md describes the look.
 */
import { html, raw } from "hono/html";
import { gizletDetail, parse, type GizletRow } from "./db";
import { handheld } from "./devices";
import type { Env } from "./env";
import { art, shell } from "./home";
import { localized, MESSAGES, rich, type Locale, type Messages } from "./i18n";
import { renderMarkdown } from "./markdown";
import { patternClasses, themeClass } from "./theme";
import { artKey } from "./mirror";
import { BUTTONS, LINK_KINDS, type Control } from "./schema";

type Detail = Awaited<ReturnType<typeof gizletDetail>>;

const MAX_ABOUT_BYTES = 64 * 1024;

/** The about page in this language, rendered from the mirrored Markdown; null without one. */
async function aboutHtml(env: Env, g: GizletRow, lang: Locale): Promise<string | null> {
  const about = parse<Record<string, string>>(g.about, {});
  const path = localized(about, about.en ?? Object.values(about)[0] ?? null, lang);
  if (!path || !g.latest_tag) return null;
  const obj = await env.BUCKET.get(artKey(g.repo, g.latest_tag, path));
  if (!obj || obj.size > MAX_ABOUT_BYTES) return null;
  return renderMarkdown(await obj.text());
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A button as the handheld labels it: face buttons by letter, the D-pad as a cross. */
function glyph(b: Control["button"], t: Messages) {
  if (b === "dpad") return html`<span class="key dpad" role="img" aria-label="${t.share.buttons.dpad}"></span>`;
  if (b === "start" || b === "select") return html`<span class="key wide">${t.share.buttons[b]}</span>`;
  if (b === "l" || b === "r") return html`<span class="key shoulder">${b.toUpperCase()}</span>`;
  return html`<span class="key face${b === "a" ? " a" : ""}">${b.toUpperCase()}</span>`;
}

export async function gizletPage(env: Env, g: GizletRow, d: Detail, lang: Locale) {
  const t = MESSAGES[lang];
  const s = t.share;
  const name = localized(d.names, d.name, lang);
  const description = localized(d.descriptions, d.description, lang);
  const about = await aboutHtml(env, g, lang);
  const installable = d.packages.some((p) => p.url);
  const controls = d.controls.slice().sort((a, b) => BUTTONS.indexOf(a.button) - BUTTONS.indexOf(b.button));
  // What to type on a device: the repository address. The launcher's GitHub source fills in github.com/.
  const [source, path] = [d.repo.slice(0, d.repo.indexOf("/")), d.repo.slice(d.repo.indexOf("/") + 1)];
  const updated = new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(d.updated_at));
  const category = t.home.category[d.category ?? d.kind] ?? t.home.category.app;
  const links = LINK_KINDS.filter((k) => d.links[k.key]).map((k) => {
    const url = new URL(d.links[k.key]!);
    return { key: k.key, name: k.name, url: url.href, shown: `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/$/, "") };
  });
  const theme = themeClass(d.color) ? ` ${themeClass(d.color)}` : "";
  const screen = d.screenshots[0] ? html`<img class="shot" src="${d.screenshots[0]}" alt="">` : html`<span class="now">${art(d, true)}</span>`;

  return html`<section class="band gz-band${theme}${patternClasses(d)}">
  <div class="wrap gz-hero">
    <div class="copy">
      <a class="back" href="/explore">← ${t.explore.title}</a>
      <p class="kicker">${category} · ${s.by(d.owner)}</p>
      <h1 class="display">${name}</h1>
      ${description ? html`<p class="lede">${description}</p>` : ""}
      <div class="cmd gz-get">
        <div class="cmd-head"><span>${s.installText}</span><button type="button" class="copy-btn" data-copy="${d.repo}" data-done="${t.devices.copied}" hidden>${t.devices.copy}</button></div>
        <pre><code><span class="p">${source}/</span>${path}</code></pre>
      </div>
      ${installable ? "" : html`<p class="gz-wait">${s.checking}</p>`}
      <p class="gz-facts">${d.version ? html`<span>${s.version(d.version)}</span>` : ""}${d.license ? html`<span>${d.license}</span>` : ""}<span>${updated}</span></p>
    </div>
    <div class="rig gz-rig">
      <span class="cart rig-cart ${shell(d)}${patternClasses(d)}" aria-hidden="true"><span class="grip"></span><span class="label">${art(d)}</span></span>
      ${handheld(screen, "body-smoke", "big")}
    </div>
  </div>
</section>

<div class="wrap gz-page">
${d.visibility === "unlisted"
  ? html`<p class="gz-unlisted"><span class="pill wait">${s.unlisted}</span>${g.visibility_reason ? html` ${s.unlistedWhy} <code>${g.visibility_reason}</code>` : ""}</p>`
  : ""}

${d.screenshots.length
  ? html`<h2 class="section-title">${s.screenshots}</h2>
<div class="gz-shots">${d.screenshots.map((u) => html`<a href="${u}"><img src="${u}" alt="" width="640" height="480" loading="lazy" decoding="async"></a>`)}</div>`
  : ""}

<div class="gz-body">
  <section class="gz-about">
    <h2 class="section-title">${s.about}</h2>
    <div class="prose">${about ? raw(about) : html`<p>${description ?? ""}</p>`}</div>
  </section>
  <aside class="gz-side">
    ${controls.length
      ? html`<section class="gz-card">
      <h3>${s.controls}</h3>
      <ul class="gz-controls">${controls.map((c) => html`<li>${glyph(c.button, t)}<span>${localized(c.actions, c.action, lang)}</span></li>`)}</ul>
    </section>`
      : ""}
    ${links.length
      ? html`<section class="gz-card">
      <h3>${s.links}</h3>
      <ul class="gz-links">${links.map(
        (l) => html`<li><a href="${l.url}" rel="nofollow noopener" class="link-${l.key}"><b>${l.key === "website" ? s.website : l.name}</b><small>${l.shown}</small></a></li>`,
      )}</ul>
    </section>`
      : ""}
    <section class="gz-card">
      <h3>${s.details}</h3>
      <dl class="gz-details">
        ${d.version ? html`<div><dt>${s.versionTitle}</dt><dd>${d.version}</dd></div>` : ""}
        <div><dt>${s.updated}</dt><dd>${updated}</dd></div>
        ${d.license ? html`<div><dt>${s.license}</dt><dd>${d.license}</dd></div>` : ""}
        <div><dt>${s.downloads}</dt><dd>${d.downloads}</dd></div>
        ${d.tags.length ? html`<div><dt>${s.tags}</dt><dd class="gz-tags">${d.tags.map((tag) => html`<span>${tag}</span>`)}</dd></div>` : ""}
        <div><dt>${s.source}</dt><dd><a href="${d.github_url}">${d.repo.replace(/^github\.com\//, "")}</a></dd></div>
      </dl>
    </section>
    <section class="gz-card">
      <h3>${s.packages}</h3>
      <ul class="gz-pkgs">${d.packages.map(
        (p) => html`<li>${p.url ? html`<a href="${p.url}">${p.target}</a>` : html`<span>${p.target}</span>`}<small>${s.tier[p.tier] ?? p.tier}${p.size ? ` · ${size(p.size)}` : ""}</small></li>`,
      )}</ul>
      <p class="note">${rich(s.packagesText)}</p>
    </section>
  </aside>
</div>
</div>`;
}

/** The Explore page: every listed gizlet as cartridges, with search and a category filter. */
import { html, raw } from "hono/html";
import { listGizlets, summary } from "./db";
import type { Env } from "./env";
import { cart } from "./home";
import { MESSAGES, type Locale } from "./i18n";
import { themeLink } from "./theme";

const PAGE = 24;

export async function explorePage(env: Env, lang: Locale, query: { q?: string; category?: string; cursor?: string }) {
  const t = MESSAGES[lang];
  const e = t.explore;
  const q = query.q?.trim().slice(0, 100) || undefined;
  const category = query.category === "game" || query.category === "app" ? query.category : undefined;
  const offset = Math.max(Number.parseInt(query.cursor ?? "0", 10) || 0, 0);
  const rows = await listGizlets(env, { q, category, limit: PAGE + 1, offset });
  const gizlets = rows.slice(0, PAGE).map((g) => summary(env, g));
  const href = (p: { category?: string; cursor?: number }) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (p.category) s.set("category", p.category);
    if (p.cursor) s.set("cursor", String(p.cursor));
    const str = s.toString();
    return `/explore${str ? `?${str}` : ""}`;
  };
  const tab = (value: string | undefined, text: string) =>
    html`<a href="${href({ category: value })}"${value === category ? raw(' aria-current="page"') : ""}>${text}</a>`;
  return html`${themeLink(gizlets.map((g) => g.color))}<section class="band">
  <div class="wrap">
    <h1 class="display">${e.title}</h1>
    <p class="lede">${e.lede}</p>
    <form class="search" action="/explore" method="get" role="search">
      <label for="q" class="visually-hidden">${e.label}</label>
      <div class="addr">
        <span class="glass" aria-hidden="true"></span>
        <input id="q" name="q" type="search" value="${q ?? ""}" placeholder="${e.placeholder}" autocomplete="off">
        ${category ? html`<input type="hidden" name="category" value="${category}">` : ""}
        <button type="submit">${e.search}</button>
      </div>
    </form>
  </div>
</section>
<div class="wrap explore">
  <nav class="tabs" aria-label="${e.label}">${tab(undefined, e.all)}${tab("game", e.games)}${tab("app", e.apps)}</nav>
  ${gizlets.length
    ? html`<div class="carts">${gizlets.map((g) => cart(g, t, lang))}</div>`
    : html`<div class="empty"><span class="cart ghost-cart" aria-hidden="true"><span class="grip"></span><span class="label"></span></span><p>${q || category ? e.none : e.empty}</p></div>`}
  ${rows.length > PAGE ? html`<p class="more"><a class="btn" href="${href({ category, cursor: offset + PAGE })}">${e.more}</a></p>` : ""}
</div>`;
}

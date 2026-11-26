/**
 * The Explore page: every listed gizlet as cartridges, with search, a kind filter (apps or
 * services) and, for apps, a category filter (games or other apps).
 */
import { html, raw } from "hono/html";
import { listGizlets, summary } from "./db";
import type { Env } from "./env";
import { cart } from "./home";
import { MESSAGES, type Locale } from "./i18n";
import { CATEGORIES, KINDS, type Category, type Kind } from "./schema";
import { patternLink, themeLink } from "./theme";

export async function explorePage(env: Env, lang: Locale, query: { q?: string; kind?: string; category?: string; cursor?: string }) {
  const PAGE = Math.min(Math.max(Number.parseInt(env.EXPLORE_PAGE_SIZE ?? "", 10) || 24, 1), 100);
  const t = MESSAGES[lang];
  const e = t.explore;
  const q = query.q?.trim().slice(0, 100) || undefined;
  const asKind = KINDS.includes(query.kind as Kind) ? (query.kind as Kind) : undefined;
  // A category is an app's; asking for one (as links from before kinds did) asks for apps.
  const category = asKind !== "service" && CATEGORIES.includes(query.category as Category) ? (query.category as Category) : undefined;
  const kind = asKind ?? (category ? "app" : undefined);
  const offset = Math.max(Number.parseInt(query.cursor ?? "0", 10) || 0, 0);
  const rows = await listGizlets(env, { q, kind, category, limit: PAGE + 1, offset });
  const gizlets = rows.slice(0, PAGE).map((g) => summary(env, g));
  const href = (p: { kind?: Kind; category?: Category; cursor?: number }) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (p.kind) s.set("kind", p.kind);
    if (p.category) s.set("category", p.category);
    if (p.cursor) s.set("cursor", String(p.cursor));
    const str = s.toString();
    return `/explore${str ? `?${str}` : ""}`;
  };
  const tab = (to: { kind?: Kind; category?: Category }, current: boolean, text: string) =>
    html`<a href="${href(to)}"${current ? raw(' aria-current="page"') : ""}>${text}</a>`;
  const hidden = (name: string, value: string | undefined) => (value ? html`<input type="hidden" name="${name}" value="${value}">` : "");
  return html`${themeLink(gizlets.map((g) => g.color))}${patternLink(gizlets)}<section class="band">
  <div class="wrap">
    <h1 class="display">${e.title}</h1>
    <p class="lede">${e.lede}</p>
    <form class="search" action="/explore" method="get" role="search">
      <label for="q" class="visually-hidden">${e.label}</label>
      <div class="addr">
        <span class="glass" aria-hidden="true"></span>
        <input id="q" name="q" type="search" value="${q ?? ""}" placeholder="${e.placeholder}" autocomplete="off">
        ${hidden("kind", kind)}${hidden("category", category)}
        <button type="submit">${e.search}</button>
      </div>
    </form>
  </div>
</section>
<div class="wrap explore">
  <nav class="tabs" aria-label="${e.kinds}">${tab({}, !kind, e.all)}${tab({ kind: "app" }, kind === "app", e.apps)}${tab({ kind: "service" }, kind === "service", e.services)}</nav>
  ${kind === "app"
    ? html`<nav class="tabs sub" aria-label="${e.categories}">${tab({ kind }, !category, e.allApps)}${tab({ kind, category: "game" }, category === "game", e.games)}${tab({ kind, category: "app" }, category === "app", e.tools)}</nav>`
    : ""}
  ${gizlets.length
    ? html`<div class="carts">${gizlets.map((g) => cart(g, t, lang))}</div>`
    : html`<div class="empty"><span class="cart ghost-cart" aria-hidden="true"><span class="grip"></span><span class="label"></span></span><p>${q || kind ? e.none : e.empty}</p></div>`}
  ${rows.length > PAGE ? html`<p class="more"><a class="btn" href="${href({ kind, category, cursor: offset + PAGE })}">${e.more}</a></p>` : ""}
</div>`;
}

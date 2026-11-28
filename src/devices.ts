/**
 * Devices: the desktop builds, every handheld we know of in one searchable table, and for each
 * supported handheld a page on writing a released Gizlet OS image to its card. Signed-in users
 * press "I want it" on handhelds that are not supported yet (the `wants` table).
 */
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Env } from "./env";
import catalogData from "./handheld-catalog.json";
import { MESSAGES, rich, type Locale } from "./i18n";
import { prompt } from "./mark";
import { icon } from "./icons";
import type { R36sRelease } from "./os-release";

const OS_RELEASE = "https://github.com/gizlet/os/releases/latest/download";

export type Status = "supported" | "wanted";
type PortProgress = "developing" | "voting" | "unpicked";
interface Port {
  progress: PortProgress;
  estimated_release_date: string | null;
}
export type DeviceView = PortProgress | "released";

export interface CatalogEntry {
  id: string;
  name: string;
  maker?: string;
  soc?: string;
  screen?: string;
  wiki?: string;
  space?: string;
}

export interface Handheld extends CatalogEntry {
  maker: string;
  soc: string;
  screen: string;
  status: Status;
}

interface Supported extends Handheld {
  status: "supported";
  /** Body colour of the drawing: a class in site.css. */
  body: string;
  specs: { soc: string; cpu: string; gpu: string; ram: string; screen: string; storage: string };
  panels: string[];
  board: string;
}

export const SUPPORTED: Supported[] = [
  {
    id: "r36s",
    name: "R36S",
    maker: "Game Console",
    soc: "Rockchip RK3326",
    screen: '3.5", 640×480',
    status: "supported",
    body: "body-smoke",
    specs: {
      soc: "Rockchip RK3326",
      cpu: "4× Cortex-A35, 1.5 GHz",
      gpu: "Mali-G31 MP2",
      ram: "1 GB DDR3L",
      screen: '3.5", 640×480 IPS',
      storage: "microSD (TF1)",
    },
    panels: ["original", "v30p4"],
    board: "gameconsole.r36s",
  },
];

/** Handhelds people can ask for. Specs only where they are the same across units. */
const WANTED: Handheld[] = [
  { id: "r35s", name: "R35S", maker: "Game Console", soc: "Rockchip RK3326", screen: '3.5", 640×480', status: "wanted" },
  { id: "r36h", name: "R36H", maker: "Game Console", soc: "Rockchip RK3326", screen: '3.5", 640×480', status: "wanted" },
  { id: "k36", name: "K36", maker: "Kinhank", soc: "Rockchip RK3326", screen: '3.5", 640×480', status: "wanted" },
  { id: "rg351p", name: "RG351P", maker: "Anbernic", soc: "Rockchip RK3326", screen: '3.5", 480×320', status: "wanted" },
  { id: "rg351m", name: "RG351M", maker: "Anbernic", soc: "Rockchip RK3326", screen: '3.5", 480×320', status: "wanted" },
  { id: "rg351v", name: "RG351V", maker: "Anbernic", soc: "Rockchip RK3326", screen: '3.5", 640×480', status: "wanted" },
  { id: "oga", name: "ODROID-GO Advance", maker: "Hardkernel", soc: "Rockchip RK3326", screen: '3.5", 480×320', status: "wanted" },
  { id: "ogs", name: "ODROID-GO Super", maker: "Hardkernel", soc: "Rockchip RK3326", screen: '5", 854×480', status: "wanted" },
  { id: "rgb10", name: "RGB10", maker: "Powkiddy", soc: "Rockchip RK3326", screen: '3.5", 480×320', status: "wanted" },
  { id: "rgb20s", name: "RGB20S", maker: "Powkiddy", soc: "Rockchip RK3326", screen: '3.5", 640×480', status: "wanted" },
  { id: "rg353v", name: "RG353V", maker: "Anbernic", soc: "Rockchip RK3566", screen: '3.5", 640×480', status: "wanted" },
  { id: "rgb30", name: "RGB30", maker: "Powkiddy", soc: "Rockchip RK3566", screen: '4", 720×720', status: "wanted" },
  { id: "rg35xxplus", name: "RG35XX Plus", maker: "Anbernic", soc: "Allwinner H700", screen: '3.5", 640×480', status: "wanted" },
  { id: "rg40xxh", name: "RG40XX H", maker: "Anbernic", soc: "Allwinner H700", screen: '4", 640×480', status: "wanted" },
];

export const HANDHELDS: Handheld[] = [...SUPPORTED, ...WANTED];

const references = new Map<string, CatalogEntry>(catalogData.map((entry) => [entry.id, entry]));
const tracked = new Map(HANDHELDS.map((entry) => [entry.id, entry]));
export const findHandheld = (id: string) => tracked.get(id);
export const findCatalogHandheld = (id: string) => tracked.get(id) ?? references.get(id);

const catalog: CatalogEntry[] = [
  ...HANDHELDS,
  ...catalogData.filter((entry) => !tracked.has(entry.id)),
];
const CATALOG_PAGE_SIZE = 40;

/** How many accounts want each handheld. */
export async function wantCounts(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare("SELECT handheld, COUNT(*) AS n FROM wants GROUP BY handheld").all<{ handheld: string; n: number }>();
  return new Map(results.map((r) => [r.handheld, r.n]));
}

export async function portProgress(env: Env): Promise<Map<string, Port>> {
  const { results } = await env.DB.prepare("SELECT handheld, progress, estimated_release_date FROM handheld_ports").all<Port & { handheld: string }>();
  return new Map(results.map(({ handheld, ...port }) => [handheld, port]));
}

export function handheldStatus(id: string, ports: ReadonlyMap<string, Port>): DeviceView {
  if (findHandheld(id)?.status === "supported") return "released";
  return ports.get(id)?.progress ?? (tracked.has(id) ? "voting" : "unpicked");
}

export function handheldJson(entry: CatalogEntry, wants: number, ports: ReadonlyMap<string, Port>) {
  const { id, name, maker = "", soc = "", screen = "" } = entry;
  return { id, name, maker, soc, screen, status: handheldStatus(id, ports), wants };
}

export const handheldImage = (entry: CatalogEntry, release: R36sRelease | null) => entry.id === "r36s" ? release?.image ?? null : null;

const DESKTOP = {
  mac: [{ label: "", file: "Gizlet-macOS.dmg" }],
  win: [{ label: "x64", href: "/assets/windows/latest/x64" }],
};

/** A handheld drawn in CSS, the cartridges' companion. `screen` is what it shows. */
export function handheld(screen: HtmlEscapedString | Promise<HtmlEscapedString> | string, body = "", extra = "") {
  return html`<div class="handheld ${body} ${extra}" aria-hidden="true">
  <div class="screen">${screen}</div>
  <div class="controls"><span class="dpad"></span><span class="abxy"><i></i><i></i><i></i><i></i></span></div>
  <div class="sticks"><i></i><i></i></div>
</div>`;
}

export const bootScreen = html`<span class="boot">${prompt}GIZLET OS</span>`;

const haystack = (h: CatalogEntry) => [h.name, h.maker, h.soc, h.id, references.get(h.id)?.name].filter(Boolean).join(" ").toLowerCase();

export function deviceView(status: string | undefined): DeviceView | undefined {
  switch (status) {
    case "released": case "supported": return "released";
    case "developing": case "development": return "developing";
    case "voting": case "all": case "wanted": return "voting";
    case "unpicked": case "catalog": return "unpicked";
  }
}

export function listHandhelds(
  view: DeviceView | "tracked",
  query: { q?: string; page?: string },
  wants: ReadonlyMap<string, number>,
  ports: ReadonlyMap<string, Port>,
  keepUnmatched = false,
) {
  const q = (query.q ?? "").trim().slice(0, 60);
  const needle = q.toLowerCase();
  const matches = (entry: CatalogEntry) => !needle || haystack(entry).includes(needle);
  const source = view === "tracked" ? HANDHELDS : catalog.filter((entry) => handheldStatus(entry.id, ports) === view);
  const ranked = source.toSorted((first, second) => (wants.get(second.id) ?? 0) - (wants.get(first.id) ?? 0));
  const entries = keepUnmatched ? ranked : ranked.filter(matches);
  const pages = view === "unpicked" ? Math.max(1, Math.ceil(entries.length / CATALOG_PAGE_SIZE)) : 1;
  const requested = /^[1-9][0-9]*$/.test(query.page ?? "") ? Number(query.page) : 1;
  const page = Math.min(requested, pages);
  const rows = view === "unpicked" ? entries.slice((page - 1) * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE) : entries;
  return { q, matches, rows, page, pages, total: entries.length };
}

export async function devicesPage(
  lang: Locale,
  query: { q?: string; status?: string; page?: string; fragment?: boolean },
  wants: Map<string, number>,
  ports: ReadonlyMap<string, Port>,
  loadRelease: () => Promise<R36sRelease | null>,
) {
  const { devices: t, js } = MESSAGES[lang];
  const votesFormat = new Intl.NumberFormat(lang);
  const wantsText = (votes: number) => (votes === 1 ? js.wants.one : js.wants.other).replace("{n}", votesFormat.format(votes));
  const view = deviceView(query.status) ?? "released";
  const isCatalog = view === "unpicked";
  const canVote = view !== "released";
  const { q, matches, rows: candidates, page, pages } = listHandhelds(view, query, wants, ports, !isCatalog);
  const release = candidates.some((entry) => entry.id === "r36s") ? await loadRelease() : null;
  const rows = view === "released" ? candidates.filter((entry) => handheldImage(entry, release)) : candidates;
  const shown = rows.some(matches);
  const href = (selected?: typeof view, pageNumber = 1) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (selected && selected !== "released") p.set("status", selected);
    if (pageNumber > 1) p.set("page", String(pageNumber));
    const str = p.toString();
    return `/install${str ? `?${str}` : ""}#handhelds`;
  };
  const tab = (selected: DeviceView, text: string) => html`<a href="${href(selected)}"${selected === view ? raw(' aria-current="page"') : ""}>${text}</a>`;
  const results = html`<div id="handheld-results">
  <div class="hh-list-card">
    <ul class="hh-list" aria-label="${t.filters[view]}"${isCatalog ? "" : raw(" data-live-search")}>
        ${rows.map((h) => {
          const supported = view === "released";
          const estimate = view === "developing" ? ports.get(h.id)?.estimated_release_date : null;
          const reference = references.get(h.id);
          const image = handheldImage(h, release);
          const votes = wants.get(h.id) ?? 0;
          const maker = h.maker && !h.name.toLowerCase().startsWith(`${h.maker.toLowerCase()} `) ? h.maker : "";
          const details = [h.name, maker, estimate && `${t.estimatedRelease} ${estimate}`].filter(Boolean).join(" · ");
          return html`<li class="is-${view}" data-search="${haystack(h)}"${matches(h) ? "" : raw(" hidden")}>
            <div class="hh-info">
              <span class="hh-description" title="${details}">
                <strong>${supported ? html`<a href="/install/${h.id}">${h.name}</a>` : h.name}</strong>
                ${maker ? html`<span>${maker}</span>` : ""}
                ${estimate ? html`<span>${t.estimatedRelease} <time datetime="${estimate}">${estimate}</time></span>` : ""}
              </span>
              ${reference?.wiki ? html`<a href="https://handhelds.wiki/${reference.wiki}">Wiki</a>` : ""}
              ${reference?.space ? html`<a href="https://handhelds.space/handhelds/${reference.space}">${t.specsTitle}</a>` : ""}
            </div>
          <div class="hh-actions">
            ${image ? html`<a class="btn small cobalt" href="${image}">${t.download}</a>` : ""}
            ${supported ? html`<a class="flash-link" href="/install/${h.id}#flash">${t.flash}</a>` : ""}
            ${canVote && !supported
              ? html`<button type="button" class="want" data-device="${h.id}" data-name="${h.name}" data-action="vote"
                  aria-label="vote · ${h.name} · ${wantsText(votes)}" aria-pressed="false">
                  ${icon("heart")}<span class="want-label" lang="en">vote</span><span class="want-n">${votesFormat.format(votes)}</span>
                </button>`
              : ""}
          </div>
        </li>`;
        })}
    </ul>
    <p class="hh-empty" role="status"${shown ? raw(" hidden") : ""}>${view === "developing" && !rows.length ? t.noDevelopment : view === "released" && !rows.length ? t.imageUnavailable : t.none}</p>
  </div>
  ${pages > 1 ? html`<nav class="catalog-pages" aria-label="${t.pagination}">
    ${page > 1 ? html`<a class="btn small" rel="prev" href="${href(view, page - 1)}">${icon("arrow-left")}${t.previous}</a>` : ""}
    <span>${t.pageNumber(page, pages)}</span>
    ${page < pages ? html`<a class="btn small" rel="next" href="${href(view, page + 1)}">${t.next}${icon("arrow-right")}</a>` : ""}
  </nav>` : ""}
</div>`;
  if (query.fragment) return results;
  return html`<section class="band">
  <div class="wrap">
    <h1 class="display">${t.title}</h1>
    <p class="lede">${t.lede}</p>
  </div>
</section>

<div class="wrap devices">
<h2 class="section-title">${t.desktopTitle}</h2>
<div class="platforms">
  <div class="platform mac">
    ${icon("laptop")}
    <div class="txt"><h3>${t.mac}</h3><p>${t.macNote}</p></div>
    <div class="btns">${DESKTOP.mac.map((f) => html`<a class="btn cobalt" href="${OS_RELEASE}/${f.file}">${t.download}</a>`)}</div>
  </div>
  <div class="platform win">
    ${icon("desktop")}
    <div class="txt"><h3>${t.win}</h3><p>${t.winNote}</p></div>
    <div class="btns">${DESKTOP.win.map((f, i) => html`<a class="btn${i === 0 ? " cobalt" : ""}" href="${f.href}">${t.download} ${f.label}</a>`)}</div>
  </div>
</div>

<section class="handhelds" id="handhelds">
  <div class="row-head"><h2 class="section-title">${t.handheldsTitle}</h2><p class="count">${t.count(SUPPORTED.length, catalog.length)}</p></div>
  <div class="table-tools">
    <form class="search" action="/install#handhelds" method="get" role="search">
      <label for="device-q" class="visually-hidden">${t.searchLabel}</label>
      <div class="addr">
        ${icon("magnifying-glass")}
        <input id="device-q" name="q" type="search" value="${q}" placeholder="${t.placeholder}" autocomplete="off">
        ${view !== "released" ? html`<input type="hidden" name="status" value="${view}">` : ""}
        <button type="submit">${t.search}</button>
      </div>
    </form>
    <nav class="tabs" aria-label="${t.handheldsTitle}">${tab("released", t.filters.released)}${tab("developing", t.filters.developing)}${tab("voting", t.filters.voting)}${tab("unpicked", t.filters.unpicked)}</nav>
  </div>
  ${results}
  ${canVote ? html`<p class="table-note">${t.wantText}</p>` : ""}
  ${canVote ? html`<p id="want-message" class="table-note" role="status"></p>` : ""}
  <section class="catalog-credits" aria-labelledby="catalog-credits-title">
    <h3 id="catalog-credits-title">${t.creditsTitle}</h3>
    <p>${t.creditsText}</p>
    <ul>
      <li><a href="https://handhelds.wiki/Category:Handheld">Handhelds Wiki</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)</li>
      <li><a href="https://handhelds.space/">Handhelds Space</a></li>
      <li><a href="https://rocknix.org/devices/">ROCKNIX</a></li>
      <li><a href="https://knulli.org/devices/">KNULLI</a></li>
    </ul>
  </section>
  ${canVote ? html`<dialog id="want-signin" class="modal" aria-labelledby="want-signin-title">
    <div class="modal-body">
      <h2 id="want-signin-title">${t.signInTitle}</h2>
      <p>${t.signInText}</p>
      <form method="dialog" class="btns">
        <a class="btn sun" href="/login?next=${encodeURIComponent(href(view))}">${t.signIn}</a>
        <button class="btn" value="cancel">${t.notNow}</button>
      </form>
    </div>
  </dialog>` : ""}
</section>
</div>`;
}

/** One supported handheld: what it is and how to flash Gizlet OS to its card. */
export function devicePage(lang: Locale, id: string, release: R36sRelease | null) {
  const d = SUPPORTED.find((s) => s.id === id);
  if (!d) return null;
  const t = MESSAGES[lang].devices;
  const keys = Object.keys(d.specs) as (keyof Supported["specs"])[];
  const sh = release && `curl -fsSL ${release.shell} | bash -s -- --board ${d.board} --release ${release.base}`;
  const ps1 = release && `& ([scriptblock]::Create((irm ${release.powershell}))) -Board ${d.board} -Release ${release.base}`;
  const cmd = (label: string, prompt: string, line: string) => html`<div class="cmd">
        <div class="cmd-head"><span>${label}</span><button type="button" class="copy-btn" data-copy="${line}" data-done="${t.copied}" hidden>${t.copy}</button></div>
        <pre><code><span class="p" aria-hidden="true">${prompt}</span>${line}</code></pre>
      </div>`;
  const step = (n: number, s: { title: string; text: string }, extra: unknown = "", cls = "") =>
    html`<li${cls ? raw(` class="${cls}"`) : ""}><span class="num">${n}</span><div><h3>${s.title}</h3><p>${rich(s.text)}</p>${extra}</div></li>`;
  return {
    name: d.name,
    body: html`<section class="band device-band">
  <div class="wrap device-hero">
    <div class="copy">
      <a class="back" href="/install#handhelds">${icon("arrow-left")} ${t.back}</a>
      <p class="kicker">${d.maker}</p>
      <h1 class="display">${d.name}</h1>
      <p class="lede">${t.detailLede}</p>
      <div class="btns"><a class="btn sun" href="#flash">${t.flash}</a></div>
    </div>
    <div class="device-art">${handheld(bootScreen, d.body, "big")}</div>
  </div>
</section>

<div class="wrap device-page">
<h2 class="section-title">${t.specsTitle}</h2>
<div class="specs-card"><dl class="spec-grid">${keys.map((k) => html`<div><dt>${t.specs[k]}</dt><dd>${d.specs[k]}</dd></div>`)}</dl></div>

<section id="flash" class="flash-guide">
  <h2 class="section-title">${t.flashTitle}</h2>
  ${release && sh && ps1 ? html`
  <p>${t.release} <b>${release.tag}</b></p>
  <p class="lede">${t.flashLede}</p>
  <ol class="flash-steps">
    ${step(1, t.steps[0]!)}
    ${step(2, t.steps[1]!, html`<div class="cmds">${cmd(t.macLinux, "$", sh)}${cmd(t.windows, ">", ps1)}</div>`, "run")}
    ${step(3, t.steps[2]!)}
    ${step(4, t.steps[3]!)}
  </ol>
  <div class="flash-aside">
    <div>
      <h3>${t.panelsTitle}</h3>
      <ul class="panel-list">${d.panels.map((panel) => html`<li>${t.panels[panel] ?? panel}</li>`)}</ul>
      <p>${rich(t.panelHelp)}</p>
    </div>
    <div>
      <h3>${t.updateTitle}</h3>
      <p>${t.updateText}</p>
    </div>
  </div>
  <details class="manual">
    <summary>${icon("caret-down")} ${t.manual}</summary>
    <p>${t.manualText} ${t.manualPanel}</p>
    <div class="images"><div class="image"><div><b>${t.panels.original}</b><code>${release.filename}</code></div><a class="btn small" href="${release.image}">${t.download}</a></div></div>
    <p class="note"><a href="${release.checksum}">${t.checksums}</a></p>
  </details>
  ` : html`<p role="status">${t.releaseUnavailable}</p>`}
</section>
</div>`,
  };
}

/**
 * Devices: the desktop builds, every handheld we know of in one searchable table, and for each
 * supported handheld a page on writing a released Gizlet OS image to its card. Signed-in users
 * press "I want it" on handhelds that are not supported yet (the `wants` table).
 */
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Env } from "./env";
import { MESSAGES, rich, type Locale } from "./i18n";
import { prompt } from "./mark";
import type { R36sRelease } from "./os-release";

export type Status = "supported" | "wanted";

export interface Handheld {
  id: string;
  name: string;
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

export const findHandheld = (id: string) => HANDHELDS.find((h) => h.id === id);

/** How many accounts want each handheld. */
export async function wantCounts(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare("SELECT handheld, COUNT(*) AS n FROM wants GROUP BY handheld").all<{ handheld: string; n: number }>();
  return new Map(results.map((r) => [r.handheld, r.n]));
}

/** A handheld in the API. */
export const handheldJson = (h: Handheld, wants: number) => ({ id: h.id, name: h.name, maker: h.maker, soc: h.soc, screen: h.screen, status: h.status, wants });

const DESKTOP = {
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

const haystack = (h: Handheld) => `${h.name} ${h.maker} ${h.soc} ${h.id}`.toLowerCase();

export function devicesPage(lang: Locale, query: { q?: string; status?: string }, wants: Map<string, number>) {
  const { devices: t, js } = MESSAGES[lang];
  const wantsText = (n: number) => (n ? (n === 1 ? js.wants.one : js.wants.other).replace("{n}", String(n)) : "");
  const q = (query.q ?? "").trim().slice(0, 60);
  const needle = q.toLowerCase();
  const status = query.status === "supported" || query.status === "wanted" ? query.status : undefined;
  const rows = HANDHELDS.filter((h) => !status || h.status === status);
  const matches = (h: Handheld) => !needle || haystack(h).includes(needle);
  const shown = rows.filter(matches).length;
  const href = (s?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("status", s);
    const str = p.toString();
    return `/install${str ? `?${str}` : ""}#handhelds`;
  };
  const tab = (s: Status | undefined, text: string) => html`<a href="${href(s)}"${s === status ? raw(' aria-current="page"') : ""}>${text}</a>`;
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
    <span class="screen-glyph" aria-hidden="true"><i></i></span>
    <div class="txt"><h3>${t.mac}</h3><p>${t.macNote}</p></div>
    <div class="btns"><a class="btn cobalt" href="/assets/macos/download">${t.download}</a></div>
  </div>
  <div class="platform win">
    <span class="screen-glyph" aria-hidden="true"><i></i></span>
    <div class="txt"><h3>${t.win}</h3><p>${t.winNote}</p></div>
    <div class="btns">${DESKTOP.win.map((f, i) => html`<a class="btn${i === 0 ? " cobalt" : ""}" href="${f.href}">${t.download} ${f.label}</a>`)}</div>
  </div>
</div>

<section class="handhelds" id="handhelds">
  <div class="row-head"><h2 class="section-title">${t.handheldsTitle}</h2><p class="count">${t.count(SUPPORTED.length, HANDHELDS.length)}</p></div>
  <div class="table-tools">
    <form class="search" action="/install#handhelds" method="get" role="search">
      <label for="device-q" class="visually-hidden">${t.searchLabel}</label>
      <div class="addr">
        <span class="glass" aria-hidden="true"></span>
        <input id="device-q" name="q" type="search" value="${q}" placeholder="${t.placeholder}" autocomplete="off">
        ${status ? html`<input type="hidden" name="status" value="${status}">` : ""}
        <button type="submit">${t.search}</button>
      </div>
    </form>
    <nav class="tabs" aria-label="${t.searchLabel}">${tab(undefined, t.filters.all)}${tab("supported", t.filters.supported)}${tab("wanted", t.filters.wanted)}</nav>
  </div>
  <div class="table-card">
    <table class="hh-table">
      <thead><tr><th scope="col">${t.cols.device}</th><th scope="col" class="c-soc">${t.cols.soc}</th><th scope="col" class="c-screen">${t.cols.screen}</th><th scope="col" class="c-status">${t.cols.status}</th><th scope="col"><span class="visually-hidden">${t.cols.action}</span></th></tr></thead>
      <tbody>
        ${rows.map((h) => {
          const ok = h.status === "supported";
          const name = html`<span class="mini" aria-hidden="true"></span><span><b>${h.name}</b><small>${h.maker}</small></span>`;
          return html`<tr class="is-${h.status}" data-search="${haystack(h)}"${matches(h) ? "" : raw(" hidden")}>
          <td>${ok ? html`<a class="hh-name" href="/install/${h.id}">${name}</a>` : html`<span class="hh-name">${name}</span>`}</td>
          <td class="c-soc">${h.soc}</td>
          <td class="c-screen">${h.screen}</td>
          <td class="c-status"><span class="pill ${ok ? "ok" : "wait"}">${t.status[h.status]}</span></td>
          <td class="act">${ok
            ? html`<a class="btn small cobalt" href="/install/${h.id}">${t.flash} →</a>`
            : html`<span class="want-n">${wantsText(wants.get(h.id) ?? 0)}</span><button type="button" class="want" data-device="${h.id}" data-name="${h.name}" aria-pressed="false"><span class="heart" aria-hidden="true"></span>${t.want}</button>`}</td>
        </tr>`;
        })}
        <tr class="none"${shown ? raw(" hidden") : ""}><td colspan="5">${t.none}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="table-note">${t.wantText}</p>
  <p id="want-message" class="table-note" role="status"></p>
  <dialog id="want-signin" class="modal" aria-labelledby="want-signin-title">
    <div class="modal-body">
      <h2 id="want-signin-title">${t.signInTitle}</h2>
      <p>${t.signInText}</p>
      <form method="dialog" class="btns">
        <a class="btn sun" href="/login?next=${encodeURIComponent("/install#handhelds")}">${t.signIn}</a>
        <button class="btn" value="cancel">${t.notNow}</button>
      </form>
    </div>
  </dialog>
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
      <a class="back" href="/install#handhelds">← ${t.back}</a>
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
    <summary>${t.manual}</summary>
    <p>${t.manualText} ${t.manualPanel}</p>
    <div class="images"><div class="image"><div><b>${t.panels.original}</b><code>${release.filename}</code></div><a class="btn small" href="${release.image}">${t.download}</a></div></div>
    <p class="note"><a href="${release.checksum}">${t.checksums}</a></p>
  </details>
  ` : html`<p role="status">${t.releaseUnavailable}</p>`}
</section>
</div>`,
  };
}

/**
 * gizlet.io/account, rendered on the server for the signed-in user: profile, the handhelds they
 * want and the devices signed in, their gizlets as cartridges, short links, and security. The
 * API (src/api.ts) serves the same data under /v1/me; public/static/account.js makes the forms work.
 * design/README.md describes the look.
 */
import { html, raw } from "hono/html";
import type { Pool } from "pg";
import { summary, type GizletRow } from "./db";
import { findHandheld, handheld, handheldJson } from "./devices";
import type { Env } from "./env";
import { UpstreamError, UserTokenRejected, userOrgs, userRepos } from "./github";
import { art, shell } from "./home";
import { localized, MESSAGES, rich, type Locale } from "./i18n";
import { currentLinks, minLengthOf, shortUrl } from "./links";
import { patternClasses, patternHref, themeHref } from "./theme";

/** The Better Auth user with our fields (src/auth.ts). */
export interface AccountUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  githubLogin?: string | null;
  linkMinLength?: number | null;
  createdAt: Date | string;
}

/** The user's GitHub OAuth token, from linking or signing in with GitHub. */
export async function githubToken(pool: Pool, userId: string): Promise<string | null> {
  return (await githubAccount(pool, userId))?.token ?? null;
}

/** The user's linked GitHub account: its OAuth token, and GitHub's id for the account, which never changes. */
export async function githubAccount(pool: Pool, userId: string): Promise<{ token: string; githubId: string } | null> {
  const { rows } = await pool.query<{ accessToken: string | null; accountId: string }>(
    `SELECT "accessToken", "accountId" FROM account WHERE "userId" = $1 AND "providerId" = 'github' ORDER BY "updatedAt" DESC LIMIT 1`,
    [userId],
  );
  const a = rows[0];
  return a?.accessToken ? { token: a.accessToken, githubId: a.accountId } : null;
}

/** Sign-in methods and the Better Auth account ids, which unlinking needs. */
export async function signInMethods(pool: Pool, userId: string): Promise<{ id: string; provider: string }[]> {
  const { rows } = await pool.query<{ id: string; providerId: string }>(`SELECT id, "providerId" FROM account WHERE "userId" = $1 ORDER BY "createdAt"`, [userId]);
  return rows.map((a) => ({ id: a.id, provider: a.providerId === "credential" ? "email" : a.providerId }));
}

/** The handhelds the user wants, newest first, with how many people want each. */
export async function myWants(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT w.handheld, w.created_at, (SELECT COUNT(*) FROM wants x WHERE x.handheld = w.handheld) AS n FROM wants w WHERE w.user_id = ? ORDER BY w.created_at DESC",
  )
    .bind(userId)
    .all<{ handheld: string; created_at: number; n: number }>();
  return results.flatMap((w) => {
    const h = findHandheld(w.handheld);
    return h ? [{ ...handheldJson(h, w.n), wanted_at: new Date(w.created_at).toISOString() }] : [];
  });
}

const iso = (d: Date | string) => new Date(d).toISOString();

/** Consoles and tools signed in through the device flow (their sessions carry a client id). */
export async function myDevices(pool: Pool, userId: string) {
  const { rows } = await pool.query<{ id: string; clientId: string; userAgent: string | null; createdAt: Date; updatedAt: Date }>(
    `SELECT id, "clientId", "userAgent", "createdAt", "updatedAt" FROM session WHERE "userId" = $1 AND "clientId" IS NOT NULL AND "expiresAt" > now() ORDER BY "updatedAt" DESC`,
    [userId],
  );
  return rows.map((s) => ({ id: s.id, client_id: s.clientId, user_agent: s.userAgent || null, signed_in_at: iso(s.createdAt), last_active_at: iso(s.updatedAt) }));
}

/** Sign out one of the user's devices; false when it is not theirs or not a device. */
export async function signOutDevice(pool: Pool, userId: string, sessionId: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM session WHERE id = $1 AND "userId" = $2 AND "clientId" IS NOT NULL`, [sessionId, userId]);
  return (res.rowCount ?? 0) > 0;
}

/** How GitHub answered for the user: fine, no longer accepting their token, or not at all. */
export type GithubState = "ok" | "relink" | "unavailable";

type CheckState = "ready" | "checking" | "failed" | "none";
const checkState = (status: string | undefined): CheckState =>
  status === "ready" ? "ready" : status === "failed" ? "failed" : status === undefined ? "none" : "checking";

/**
 * The gizlets in repositories of the user's GitHub account and its organizations, and those
 * GitHub lists among the user's repositories (collaborator too), with their newest release's
 * checks, short link, and whether the user may set it (admin or maintain on the repository).
 */
export async function myGizlets(env: Env, pool: Pool, user: AccountUser) {
  const login = user.githubLogin ?? null;
  const min = minLengthOf(user.linkMinLength);
  if (!login) return { github_login: null, github: null, link_min_length: min, gizlets: [] };
  const token = await githubToken(pool, user.id);
  let repos = new Map<string, { id: number; manage: boolean }>();
  const owners = [login];
  let github: GithubState = token ? "ok" : "relink";
  if (token) {
    try {
      const [r, orgs] = await Promise.all([userRepos(env, token), userOrgs(env, token)]);
      repos = r;
      owners.push(...orgs);
    } catch (e) {
      if (e instanceof UserTokenRejected) github = "relink";
      else if (e instanceof UpstreamError || e instanceof TypeError) github = "unavailable";
      else throw e;
    }
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM gizlets WHERE lower(owner) IN (SELECT lower(value) FROM json_each(?1)) OR repo IN (SELECT value FROM json_each(?2))
      ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(JSON.stringify(owners), JSON.stringify([...repos.keys()]))
    .all<GizletRow>();
  const { results: releases } = await env.DB.prepare(
    `SELECT r.repo, r.tag, r.status, r.error FROM releases r WHERE r.repo IN (SELECT value FROM json_each(?1))
       AND r.published_at = (SELECT max(x.published_at) FROM releases x WHERE x.repo = r.repo)`,
  )
    .bind(JSON.stringify(results.map((g) => g.repo)))
    .all<{ repo: string; tag: string; status: string; error: string | null }>();
  const links = await currentLinks(env, results);
  return {
    github_login: login,
    github,
    link_min_length: min,
    gizlets: results.map((g) => {
      const rel = releases.find((r) => r.repo === g.repo);
      const id = links.get(g.repo);
      const own = g.owner.toLowerCase() === login.toLowerCase();
      const seen = repos.get(g.repo);
      // The user's repository at this path must be the gizlet's, not another one created there since.
      // Their token does not list private repositories; setting a link asks GitHub through the app.
      const manage = seen ? seen.manage && (g.repository_id == null || seen.id === g.repository_id) : own || g.private === 1;
      return {
        ...summary(env, g),
        owner: g.owner,
        visibility_reason: g.visibility_reason,
        release: rel ? { tag: rel.tag, status: rel.status, error: rel.error } : null,
        checks: checkState(rel?.status),
        link: id ? { id, url: shortUrl(env, id) } : null,
        can_link: g.visibility !== "blocked" && manage,
      };
    }),
  };
}

export interface AccountData {
  user: AccountUser;
  methods: { id: string; provider: string }[];
  wants: Awaited<ReturnType<typeof myWants>>;
  devices: Awaited<ReturnType<typeof myDevices>>;
  mine: Awaited<ReturnType<typeof myGizlets>>;
}

export async function accountData(env: Env, pool: Pool, user: AccountUser): Promise<AccountData> {
  const [methods, wants, devices, mine] = await Promise.all([signInMethods(pool, user.id), myWants(env, user.id), myDevices(pool, user.id), myGizlets(env, pool, user)]);
  return { user, methods, wants, devices, mine };
}

// --- The page -------------------------------------------------------------------------------------

export const ACCOUNT_TABS = ["profile", "handhelds", "gizlets", "links", "security"] as const;

const BODIES = ["body-sun", "body-coral", "body-mint", "body-sky"];

function avatar(user: AccountUser, size = "") {
  const initial = [...(user.name.trim() || user.email)][0]!.toUpperCase();
  return user.image
    ? html`<img class="avatar ${size}" src="${user.image}" alt="" width="96" height="96" referrerpolicy="no-referrer">`
    : html`<span class="avatar initial ${size}" aria-hidden="true">${initial}</span>`;
}

export function accountPage(env: Env, lang: Locale, d: AccountData, githubEnabled: boolean) {
  const all = MESSAGES[lang];
  const t = all.account;
  const day = (s: Date | string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(s));
  const host = new URL(env.SITE_ORIGIN).host;
  const { user, mine } = d;
  const github = d.methods.find((m) => m.provider === "github");
  const hasPassword = d.methods.some((m) => m.provider === "email");
  const linkButton = (label: string, cls = "btn cobalt") =>
    githubEnabled ? html`<button type="button" class="${cls} link-github">${label}</button>` : html`<p class="note">${t.githubOff}</p>`;
  const nameOf = (g: (typeof mine.gizlets)[number]) => localized(g.names, g.name, lang);

  const profile = html`<div class="acct-grid">
  <section class="acct-card">
    <h2>${t.tabs.profile}</h2>
    <form id="name-form" class="acct-form">
      <label>${t.name} <input name="name" value="${user.name}" maxlength="80" autocomplete="nickname" required></label>
      <button type="submit">${t.save}</button>
    </form>
    <div class="acct-picture">${avatar(user, "small")}<div><b>${t.picture}</b><p>${user.image ? t.pictureGithub : t.pictureNone}</p></div></div>
  </section>
  <section class="acct-card">
    <h2>${t.email}</h2>
    <p class="acct-email"><b>${user.email}</b>${user.emailVerified ? html` <span class="pill ok">${t.confirmed}</span>` : ""}</p>
    <form id="email-form" class="acct-form">
      <label>${t.newEmail} <input name="email" type="email" autocomplete="email" required></label>
      <button type="submit" class="secondary">${t.sendLink}</button>
    </form>
    <p class="note">${t.emailText}</p>
  </section>
</div>`;

  const handhelds = html`<div class="acct-head"><h2>${t.wants}</h2><p>${t.wantsText}</p></div>
<ul class="want-cards" id="wants"${d.wants.length ? "" : raw(" hidden")}>${d.wants.map((h, i) => {
    const supported = h.status === "supported";
    return html`<li class="want-card">
  <div class="want-art">${handheld(html`<span class="hh-label">${h.name}</span>`, BODIES[i % BODIES.length], "tiny")}</div>
  <div class="want-txt">
    <h3>${h.name}</h3>
    <p>${h.maker} · ${h.soc}</p>
    <span class="pill ${supported ? "ok" : "wait"}">${supported ? t.supported : t.wantCount(h.wants)}</span>
  </div>
  <div class="want-acts">
    ${supported ? html`<a class="btn small sun" href="/install/${h.id}">${t.flash}</a>` : ""}
    <button type="button" class="link unwant" data-handheld="${h.id}">${t.remove}</button>
  </div>
</li>`;
  })}</ul>
<div class="empty" id="no-wants"${d.wants.length ? raw(" hidden") : ""}><div class="ghost-hh" aria-hidden="true"></div><p>${t.noWants}</p><a class="btn" href="/install#handhelds">${t.findHandhelds}</a></div>
<div class="acct-head"><h2>${t.devices}</h2><p>${t.devicesText}</p></div>
<ul class="device-list" id="devices"${d.devices.length ? "" : raw(" hidden")}>${d.devices.map((s) => {
    const name = t.deviceNames[s.client_id] ?? s.client_id;
    return html`<li><span class="mini" aria-hidden="true"></span><div><b>${name}</b><small>${t.deviceTimes(day(s.signed_in_at), day(s.last_active_at))}</small></div><button type="button" class="secondary small signout-device" data-session="${s.id}" data-name="${name}">${t.signOutDevice}</button></li>`;
  })}</ul>
<p class="acct-note" id="no-devices"${d.devices.length ? raw(" hidden") : ""}>${rich(t.noDevices)}</p>`;

  const githubNote =
    mine.github === "relink"
      ? html`<div class="acct-note warn"><p>${t.relink}</p>${linkButton(t.linkGithub, "btn small")}</div>`
      : mine.github === "unavailable"
        ? html`<p class="acct-note warn">${t.githubDown}</p>`
        : "";

  const cartOf = (g: (typeof mine.gizlets)[number]) => html`<a class="cart acct-cart ${shell(g)}${patternClasses(g)}" href="/${g.repo}">
  <span class="grip" aria-hidden="true"></span>
  <span class="label">${art(g)}</span>
  <span class="name">${nameOf(g)}</span>
  <span class="repo">${g.repo.replace(/^github\.com\//, "")}</span>
  <span class="meta">${g.version ? html`<span>v${g.version}</span>` : ""}<span>${t.visibility[g.visibility] ?? g.visibility}</span></span>
  <span class="check check-${g.checks}"${g.release?.error ? html` title="${g.release.error}"` : ""}>${t.status[g.checks]}</span>
</a>`;

  const gizlets = mine.github_login
    ? html`<div class="acct-head"><h2>${t.gizlets}</h2><p>${t.gizletsText(mine.github_login)}</p></div>
${githubNote}
${mine.gizlets.length ? html`<div class="carts">${mine.gizlets.map(cartOf)}</div>` : html`<div class="empty"><span class="cart ghost-cart" aria-hidden="true"><span class="grip"></span><span class="label"></span></span><p>${rich(t.noGizlets)}</p></div>`}`
    : html`<div class="empty acct-link"><span class="cart ghost-cart" aria-hidden="true"><span class="grip"></span><span class="label"></span></span><div><h2>${t.linkTitle}</h2><p>${t.linkText}</p>${linkButton(t.linkGithub)}</div></div>`;

  const linkRow = (g: (typeof mine.gizlets)[number], i: number) => {
    const name = nameOf(g);
    const current = g.link?.id ?? "";
    const url = current ? shortUrl(env, current) : "";
    return html`<li class="link-row" data-repo="${g.repo}" data-name="${name}">
  <span class="link-art ${shell(g)}">${art(g)}</span>
  <div class="link-who"><b>${name}</b><small>${g.repo.replace(/^github\.com\//, "")}</small></div>
  ${g.can_link
    ? html`<form class="link-form" data-current="${current}" novalidate>
    <label class="visually-hidden" for="link-${i}">${t.linkFor(name)}</label>
    <div class="addr"><span class="prefix">${host}/</span><input id="link-${i}" name="id" value="${current}" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit">${t.save}</button></div>
    <p class="link-state" aria-live="polite"></p>
    <div class="link-tools"${current ? "" : raw(" hidden")}><a class="link-url" href="/${current}">${host}/${current}</a><button type="button" class="copy-btn" data-copy="${url}" data-done="${all.devices.copied}">${all.devices.copy}</button><button type="button" class="link remove-link">${t.removeLink}</button></div>
  </form>`
    : html`<div class="link-ro">${current ? html`<a class="link-url" href="/${current}">${host}/${current}</a>` : ""}<p class="note">${t.notManager}</p></div>`}
</li>`;
  };
  // A short link opens the gizlet's page, which needs a release that passed its checks.
  const linkable = mine.gizlets.filter((g) => g.visibility !== "blocked" && g.tag);
  const links = html`<div class="acct-head"><h2>${t.links}</h2><p>${t.linksText(host, mine.link_min_length)}</p><p class="note">${t.linksHold}</p></div>
${!mine.github_login
  ? html`<p class="acct-note">${t.linksGithub} <a href="#gizlets">${t.tabs.gizlets} →</a></p>`
  : linkable.length
    ? html`<ul class="link-rows">${linkable.map(linkRow)}</ul>`
    : html`<p class="acct-note">${t.linksEmpty}</p>`}`;

  const security = html`<div class="acct-grid">
  <section class="acct-card">
    <h2>${t.password}</h2>
    ${hasPassword
      ? html`<form id="password-form" class="acct-form">
      <label>${t.currentPassword} <input name="current" type="password" autocomplete="current-password" required></label>
      <label>${t.newPassword} <input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
      <button type="submit">${t.changePassword}</button>
    </form>`
      : html`<p class="note">${t.noPassword}</p>`}
  </section>
  <section class="acct-card">
    <h2>${t.methods}</h2>
    <ul class="methods">
      ${hasPassword ? html`<li><span class="method-icon mail" aria-hidden="true"></span><div><b>${t.methodEmail}</b><small>${user.email}</small></div></li>` : ""}
      <li><span class="method-icon gh" aria-hidden="true"></span><div><b>GitHub</b><small>${mine.github_login ? `@${mine.github_login}` : "—"}</small></div>
        ${github ? html`<button type="button" class="secondary small" id="unlink-github" data-account="${github.id}">${t.unlinkGithub}</button>` : githubEnabled ? html`<button type="button" class="small link-github">${t.linkGithub}</button>` : ""}</li>
    </ul>
    ${github ? html`<p class="note">${t.unlinkText}</p>` : ""}
  </section>
  <section class="acct-card">
    <h2>${t.signOut}</h2>
    <p class="note">${t.signOutText}</p>
    <button type="button" class="secondary" id="signout">${t.signOut}</button>
  </section>
</div>`;

  const panels = { profile, handhelds, gizlets, links, security };
  const body = html`<section class="band acct-band">
  <div class="wrap acct-hero">
    ${avatar(user)}
    <div class="acct-who">
      <p class="kicker">${t.title}</p>
      <h1 class="display" id="acct-name">${user.name}</h1>
      <p class="acct-sub"><span id="acct-email">${user.email}</span>${mine.github_login ? html` · <a href="https://github.com/${mine.github_login}">@${mine.github_login}</a>` : ""} · ${t.since(day(user.createdAt))}</p>
    </div>
  </div>
  <div class="wrap"><nav class="acct-tabs" aria-label="${t.tabsLabel}"><div role="tablist">${ACCOUNT_TABS.map(
    (id) => html`<a role="tab" id="tab-${id}" href="#${id}" aria-controls="panel-${id}">${t.tabs[id]}${id === "handhelds" && d.wants.length ? html`<span class="n">${d.wants.length}</span>` : ""}${id === "gizlets" && mine.gizlets.length ? html`<span class="n">${mine.gizlets.length}</span>` : ""}</a>`,
  )}</div></nav></div>
</section>
<div class="wrap acct" data-min="${mine.link_min_length}" data-host="${host}">
${ACCOUNT_TABS.map((id) => html`<section class="acct-panel" id="panel-${id}" role="tabpanel" aria-labelledby="tab-${id}">${panels[id]}</section>\n`)}
</div>
<p id="message" class="toast" role="status"></p>`;
  const styles = [themeHref(mine.gizlets.map((g) => g.color)), patternHref(mine.gizlets)].filter((s): s is string => !!s);
  return { body, styles };
}

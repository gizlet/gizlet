// The account page (src/account.ts): its tabs, and the forms that change the account through
// Better Auth (/v1/auth) and the API (/v1/me, /v1/links). The page is rendered signed in.
import { call, fmt, message, t } from "./auth.js";

const TABS = ["profile", "handhelds", "gizlets", "links", "security"];
const tabs = [...document.querySelectorAll('.acct-tabs [role="tab"]')];
const acct = document.querySelector(".acct");
const MIN = Number(acct.dataset.min);
const HOST = acct.dataset.host;
const LINK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// --- Tabs: the hash names the open one, so links and reloads keep it. Panels are `panel-<tab>`, so
// the browser does not scroll to them. ----------------------------------------------------------------

const tabOf = (tab) => tab.getAttribute("href").slice(1);

function show(id, focus = false) {
  if (!TABS.includes(id)) id = "profile";
  for (const tab of tabs) {
    const on = tabOf(tab) === id;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
    // On a narrow screen the tabs scroll sideways; keep the open one in view.
    if (on) {
      const list = tab.parentElement;
      if (tab.offsetLeft < list.scrollLeft || tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = tab.offsetLeft - 16;
    }
  }
  for (const panel of document.querySelectorAll(".acct-panel")) panel.hidden = panel.id !== `panel-${id}`;
}

function open(id, focus = false) {
  history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
  show(id, focus);
}

for (const tab of tabs) {
  tab.addEventListener("click", (e) => {
    e.preventDefault();
    open(tabOf(tab));
  });
  tab.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
    open(tabOf(tabs[i]), true);
  });
}
addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1));

// --- Messages ------------------------------------------------------------------------------------

const toast = document.querySelector("#message");
let hideToast;
function say(text) {
  message(text);
  toast.classList.add("on");
  clearTimeout(hideToast);
  hideToast = setTimeout(() => toast.classList.remove("on"), 6000);
}

// Back from an email link (?email=changed) or from GitHub (?error=...).
{
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  if (error) say(t.errors?.[error] ?? fmt(t.requestFailed, { status: error }));
  else if (params.get("email") === "changed") say(t.emailChanged);
  if (error || params.has("email")) history.replaceState(null, "", `${location.pathname}${location.hash}`);
}

/** The API on this site; errors carry a message in the page's language. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return res.status === 204 ? null : res.json();
  const data = await res.json().catch(() => null);
  throw new Error(t.errors?.[data?.error?.code] ?? data?.error?.message ?? fmt(t.requestFailed, { status: res.status }));
}

/** Run a button's or form's action with the button disabled; errors become the message. */
async function busy(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (err) {
    say(err.message);
  } finally {
    button.disabled = false;
  }
}

function onSubmit(form, action) {
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector('button[type="submit"]'), action);
  });
}

/** A tab's count badge. */
function setCount(tab, n) {
  const badge = document.querySelector(`#tab-${tab} .n`);
  if (!badge) return;
  if (n > 0) badge.textContent = String(n);
  else badge.remove();
}

// --- Profile ---------------------------------------------------------------------------------------

const nameForm = document.querySelector("#name-form");
onSubmit(nameForm, async () => {
  // `nameForm.name` is the form's own name; the field is in `elements`.
  const name = nameForm.elements.name.value.trim();
  if (!name) return;
  await call("/update-user", { name });
  document.querySelector("#acct-name").textContent = name;
  say(t.saved);
});

const emailForm = document.querySelector("#email-form");
onSubmit(emailForm, async () => {
  const newEmail = emailForm.email.value.trim();
  await call("/change-email", { newEmail, callbackURL: "/account?email=changed#profile" });
  emailForm.reset();
  say(fmt(t.emailSent, { email: newEmail }));
});

// --- Handhelds -------------------------------------------------------------------------------------

/** Remove a list item; when the list empties, its empty state shows instead. */
function drop(li, list, empty) {
  li.remove();
  if (!list.children.length) {
    list.hidden = true;
    document.querySelector(empty).hidden = false;
  }
}

for (const button of document.querySelectorAll(".unwant")) {
  button.addEventListener("click", () =>
    busy(button, async () => {
      await api("DELETE", `/v1/me/wants/${encodeURIComponent(button.dataset.handheld)}`);
      const list = document.querySelector("#wants");
      drop(button.closest("li"), list, "#no-wants");
      setCount("handhelds", list.children.length);
    }),
  );
}

for (const button of document.querySelectorAll(".signout-device")) {
  button.addEventListener("click", () =>
    busy(button, async () => {
      await api("DELETE", `/v1/me/devices/${encodeURIComponent(button.dataset.session)}`);
      drop(button.closest("li"), document.querySelector("#devices"), "#no-devices");
      say(fmt(t.deviceSignedOut, { name: button.dataset.name }));
    }),
  );
}

// --- GitHub ----------------------------------------------------------------------------------------

for (const button of document.querySelectorAll(".link-github")) {
  button.addEventListener("click", () =>
    busy(button, async () => {
      const { url } = await call("/link-social", { provider: "github", callbackURL: "/account#gizlets", errorCallbackURL: "/account#gizlets" });
      location.assign(url);
    }),
  );
}

const unlink = document.querySelector("#unlink-github");
unlink?.addEventListener("click", () =>
  busy(unlink, async () => {
    // Better Auth 1.7 takes its own account id; providerId is what other versions take instead.
    await call("/unlink-account", { accountId: unlink.dataset.account, providerId: "github" });
    location.reload();
  }),
);

// --- Short links -----------------------------------------------------------------------------------

/** What is wrong with an id before asking the server, or null. */
function problem(id) {
  if (id.length > 32) return t.linkLong;
  if (!LINK_ID.test(id)) return t.linkFormat;
  if (id.length < MIN) return fmt(t.linkShort, { min: MIN });
  return null;
}

for (const form of document.querySelectorAll(".link-form")) {
  const row = form.closest(".link-row");
  const input = form.elements.id;
  const state = form.querySelector(".link-state");
  const tools = form.querySelector(".link-tools");
  const shown = tools.querySelector(".link-url");
  const copy = tools.querySelector(".copy-btn");
  let timer;
  let asked = 0;
  const setState = (text, kind = "") => {
    state.textContent = text;
    state.className = `link-state ${kind}`.trim();
  };
  const setCurrent = (id, url) => {
    form.dataset.current = id;
    input.value = id;
    tools.hidden = !id;
    shown.href = `/${id}`;
    shown.textContent = `${HOST}/${id}`;
    copy.dataset.copy = url;
  };

  // As you type: the format first, then whether the id is free.
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const id = input.value.trim().toLowerCase();
    const ask = ++asked;
    if (!id || id === form.dataset.current) return setState(id ? t.linkMine : "", "ok");
    const bad = problem(id);
    if (bad) return setState(bad, "bad");
    setState(t.linkChecking);
    timer = setTimeout(async () => {
      const res = await fetch(`/v1/links/${encodeURIComponent(id)}`, { credentials: "same-origin" }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (ask !== asked || !res) return;
      const url = `${HOST}/${id}`;
      if (res.ok) {
        // Held for this gizlet since it was replaced: it can be taken back.
        if (data.repo === row.dataset.repo) return setState(data.current ? t.linkMine : fmt(t.linkFree, { url }), "ok");
        return setState(fmt(t.linkTaken, { url }), "bad");
      }
      if (res.status === 404) return data?.error?.available ? setState(fmt(t.linkFree, { url }), "ok") : setState(fmt(t.linkTaken, { url }), "bad");
      setState(data?.error?.code === "reserved" ? fmt(t.linkReserved, { id }) : t.linkFormat, "bad");
    }, 300);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = input.value.trim().toLowerCase();
    if (!id || id === form.dataset.current) return;
    const bad = problem(id);
    if (bad) return setState(bad, "bad");
    clearTimeout(timer);
    asked++;
    busy(form.querySelector('button[type="submit"]'), async () => {
      try {
        const link = await api("PUT", `/v1/me/gizlets/${row.dataset.repo}/link`, { id });
        setCurrent(link.id, link.url);
        setState("");
        say(fmt(t.linkSaved, { url: `${HOST}/${link.id}`, name: row.dataset.name }));
      } catch (err) {
        setState(err.message, "bad");
      }
    });
  });

  const remove = tools.querySelector(".remove-link");
  remove.addEventListener("click", () =>
    busy(remove, async () => {
      const old = form.dataset.current;
      await api("DELETE", `/v1/me/gizlets/${row.dataset.repo}/link`);
      setCurrent("", "");
      setState("");
      say(fmt(t.linkRemoved, { url: `${HOST}/${old}` }));
    }),
  );
}

for (const button of document.querySelectorAll(".copy-btn")) {
  button.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(button.dataset.copy).catch(() => {});
    const label = button.textContent;
    button.textContent = button.dataset.done;
    setTimeout(() => (button.textContent = label), 1500);
  });
}

// --- Security --------------------------------------------------------------------------------------

const passwordForm = document.querySelector("#password-form");
onSubmit(passwordForm, async () => {
  await call("/change-password", { currentPassword: passwordForm.current.value, newPassword: passwordForm.next.value, revokeOtherSessions: false });
  passwordForm.reset();
  say(t.passwordChanged);
});

const signout = document.querySelector("#signout");
signout.addEventListener("click", () =>
  busy(signout, async () => {
    await call("/sign-out", {});
    location.assign("/");
  }),
);

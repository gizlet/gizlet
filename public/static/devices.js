// Devices and gizlet pages: filter the handheld table as you type, want handhelds, copy commands, and show screenshots full size.
import { fmt, t } from "./auth.js";

const input = document.querySelector("#device-q");
const table = document.querySelector(".hh-table");
if (input && table) {
  const rows = [...table.querySelectorAll("tbody tr[data-search]")];
  const none = table.querySelector("tr.none");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const ok = !q || r.dataset.search.includes(q);
      r.hidden = !ok;
      if (ok) shown++;
    }
    if (none) none.hidden = shown > 0;
  });
}

// The want a sign-in from the dialog is for. localStorage, since the email link of a sign-up opens in
// another tab; kept as long as that link works.
const PENDING_WANT = "gizlet.want";
const PENDING_FOR = 24 * 60 * 60 * 1000;

function rememberWant(id) {
  try {
    localStorage.setItem(PENDING_WANT, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // No storage: after signing in, the user presses the button again.
  }
}

/** The want this browser was signing in for, if it is `id`; forgotten either way. */
function takePendingWant(id) {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_WANT) ?? "null");
    localStorage.removeItem(PENDING_WANT);
    return p?.id === id && Date.now() - p.at < PENDING_FOR;
  } catch {
    return false;
  }
}

// "I want it" on a handheld we do not support yet: a want on the signed-in account (/v1/me/wants).
// Signed out, a dialog offers to sign in; that comes back here with ?want=<id>, which records the want
// only if this browser started that sign-in from the dialog, so a link alone never records one.
const wantButtons = [...document.querySelectorAll("button.want[data-device]")];
if (wantButtons.length) setUpWants(wantButtons);

function setUpWants(buttons) {
  const say = (text) => (document.querySelector("#want-message").textContent = text);
  const dialog = document.querySelector("#want-signin");
  const params = new URLSearchParams(location.search);
  const asked = params.get("want");
  const pending = asked !== null && takePendingWant(asked) ? asked : null;
  if (asked !== null) {
    params.delete("want");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  }
  const show = (b, wanted, count) => {
    b.setAttribute("aria-pressed", String(wanted));
    if (count !== undefined) b.previousElementSibling.textContent = count ? fmt(count === 1 ? t.wants.one : t.wants.other, { n: count }) : "";
  };
  // The ids the user wants; null when signed out, undefined when they could not be loaded.
  const mine = fetch("/v1/me/wants", { credentials: "same-origin", cache: "no-store" })
    .then(async (res) => (res.ok ? new Set((await res.json()).wants.map((w) => w.id)) : res.status === 401 ? null : undefined))
    .catch(() => undefined);

  const askToSignIn = (b) => {
    const back = new URLSearchParams(location.search);
    back.set("want", b.dataset.device);
    dialog.dataset.device = b.dataset.device;
    dialog.querySelector("a").href = `/login?next=${encodeURIComponent(`${location.pathname}?${back}#handhelds`)}`;
    dialog.querySelector("h2").textContent = fmt(t.wantSignIn, { name: b.dataset.name });
    dialog.showModal();
  };
  dialog.querySelector("a").addEventListener("click", () => rememberWant(dialog.dataset.device));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  const want = async (b, wanted) => {
    b.disabled = true;
    say("");
    try {
      const res = await fetch(`/v1/me/wants/${encodeURIComponent(b.dataset.device)}`, { method: wanted ? "PUT" : "DELETE", credentials: "same-origin" });
      if (res.status === 401) return askToSignIn(b);
      if (!res.ok) return say(fmt(t.requestFailed, { status: res.status }));
      const data = await res.json();
      show(b, data.wanted, data.wants);
    } catch {
      say(fmt(t.requestFailed, { status: "?" }));
    } finally {
      b.disabled = false;
    }
  };

  for (const b of buttons) {
    b.addEventListener("click", async () => {
      if ((await mine) === null) return askToSignIn(b);
      want(b, b.getAttribute("aria-pressed") !== "true");
    });
  }
  mine.then((ids) => {
    if (!ids) return;
    for (const b of buttons) show(b, ids.has(b.dataset.device));
    const back = pending && buttons.find((b) => b.dataset.device === pending);
    if (back && !ids.has(pending)) want(back, true);
  });
}

for (const b of document.querySelectorAll("button.copy-btn")) {
  b.hidden = false;
  const label = b.textContent;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = b.dataset.done;
      setTimeout(() => (b.textContent = label), 1600);
    } catch {
      // No clipboard access: the command is still there to select.
    }
  });
}

// Gizlet pages: a screenshot opens full size; clicking outside the image or Esc closes it.
const shots = document.querySelector(".gz-shots");
if (shots && typeof HTMLDialogElement === "function") {
  const box = document.createElement("dialog");
  box.className = "lightbox";
  box.setAttribute("aria-label", shots.previousElementSibling?.textContent ?? "");
  const img = document.createElement("img");
  img.alt = "";
  box.append(img);
  document.body.append(box);
  shots.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    img.src = a.href;
    box.showModal();
  });
  box.addEventListener("click", (e) => {
    if (e.target !== img) box.close();
  });
  box.addEventListener("close", () => img.removeAttribute("src"));
}

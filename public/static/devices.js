// Devices and gizlet pages: filter the handheld table as you type, want handhelds, copy commands, and show screenshots full size.
import { fmt, t } from "./auth.js";

const input = document.querySelector("#device-q");
const results = document.querySelector("#handheld-results");

function filterHandhelds() {
  const list = results?.querySelector(".hh-list[data-live-search]");
  if (!input || !list) return;
  const query = input.value.trim().toLowerCase();
  const none = results.querySelector(".hh-empty");
  let shown = false;
  for (const row of list.querySelectorAll("li[data-search]")) {
    row.hidden = !row.dataset.search.includes(query);
    shown ||= !row.hidden;
  }
  if (none) none.hidden = shown;
}
input?.addEventListener("input", filterHandhelds);

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

// "I want it" on a handheld we do not support yet: a want on the signed-in account (/api/v1/me/wants).
// Signed out, a dialog offers to sign in; that comes back here with ?want=<id>, which records the want
// only if this browser started that sign-in from the dialog, so a link alone never records one.
const wantDialog = document.querySelector("#want-signin");
if (results && wantDialog) setUpWants(results, wantDialog);

function setUpWants(results, dialog) {
  const say = (text) => (document.querySelector("#want-message").textContent = text);
  const numbers = new Intl.NumberFormat(document.documentElement.lang);
  const votes = new Set();
  const submitting = new Set();
  const buttonFor = (id) => results.querySelector(`button.want[data-device="${CSS.escape(id)}"]`);
  const params = new URLSearchParams(location.search);
  const asked = params.get("want");
  const pending = asked !== null && takePendingWant(asked) ? asked : null;
  if (asked !== null) {
    params.delete("want");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  }
  const pressed = () => {
    for (const button of results.querySelectorAll("button.want[data-device]")) {
      button.setAttribute("aria-pressed", String(votes.has(button.dataset.device)));
    }
  };
  function loadMyVotes() {
    return fetch("/api/v1/me/wants", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (!response.ok && response.status !== 401) return "unavailable";
      const personal = response.ok ? (await response.json()).wants : [];
      votes.clear();
      for (const vote of personal) votes.add(vote.id);
      pressed();
      return response.ok ? "signedIn" : "signedOut";
    }).catch(() => "unavailable");
  }
  let mine = loadMyVotes();

  let snapshot = results.innerHTML;
  let refreshRequest;
  async function refresh() {
    if (document.hidden || submitting.size || refreshRequest) return;
    const request = new AbortController();
    refreshRequest = request;
    const url = new URL(location.href);
    url.searchParams.set("fragment", "handhelds");
    url.searchParams.set("lang", document.documentElement.lang);
    try {
      const response = await fetch(url, { cache: "no-store", signal: request.signal });
      if (!response.ok) return;
      const documentFragment = new DOMParser().parseFromString(await response.text(), "text/html");
      const next = documentFragment.querySelector("#handheld-results");
      if (request.signal.aborted || !next || next.innerHTML === snapshot) return;
      const focused = document.activeElement?.closest("button.want")?.dataset.device;
      snapshot = next.innerHTML;
      results.replaceChildren(...next.childNodes);
      filterHandhelds();
      pressed();
      if (focused) buttonFor(focused)?.focus({ preventScroll: true });
    } catch {
      return;
    } finally {
      if (refreshRequest === request) refreshRequest = undefined;
    }
  }
  setInterval(refresh, 5000);
  const resume = () => {
    if (document.hidden) return;
    if (!submitting.size) mine = loadMyVotes();
    refresh();
  };
  document.addEventListener("visibilitychange", resume);
  addEventListener("pageshow", (event) => {
    if (event.persisted) resume();
  });

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

  const want = async (id, wanted, button) => {
    if (submitting.has(id)) return;
    submitting.add(id);
    refreshRequest?.abort();
    refreshRequest = undefined;
    if (button) button.disabled = true;
    say("");
    try {
      const res = await fetch(`/api/v1/me/wants/${encodeURIComponent(id)}`, { method: wanted ? "PUT" : "DELETE", credentials: "same-origin" });
      if (res.status === 401 && button) return askToSignIn(button);
      if (!res.ok) return say(fmt(t.requestFailed, { status: res.status }));
      const saved = await res.json();
      if (saved.wanted) votes.add(id);
      else votes.delete(id);
      const current = buttonFor(id);
      if (current) {
        const count = numbers.format(saved.wants);
        const label = fmt(saved.wants === 1 ? t.wants.one : t.wants.other, { n: count });
        current.querySelector(".want-n").textContent = count;
        current.setAttribute("aria-label", `${current.dataset.action} · ${current.dataset.name} · ${label}`);
        current.setAttribute("aria-pressed", String(saved.wanted));
      }
    } catch {
      say(fmt(t.requestFailed, { status: "?" }));
    } finally {
      submitting.delete(id);
      if (button) button.disabled = false;
      refresh();
    }
  };

  results.addEventListener("click", async (event) => {
    const button = event.target.closest("button.want[data-device]");
    if (!button) return;
    const session = await mine;
    if (session === "signedOut") return askToSignIn(button);
    if (session === "unavailable") return say(fmt(t.requestFailed, { status: "?" }));
    want(button.dataset.device, !votes.has(button.dataset.device), button);
  });
  mine.then((session) => {
    if (session === "signedIn" && pending && !votes.has(pending)) want(pending, true, buttonFor(pending));
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

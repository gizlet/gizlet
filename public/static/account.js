import { call, fmt, message, signIn, t } from "./auth.js";

const res = await fetch("/v1/me", { credentials: "same-origin" });
if (res.status === 401) signIn("/account");
else if (!res.ok) message(fmt(t.loadFailed, { status: res.status }));
else {
  const me = await res.json();
  document.querySelector("#name").textContent = me.user.name;
  document.querySelector("#email").textContent = me.user.email;
  document.querySelector("#methods").textContent = me.sign_in_methods.map((m) => t.methods[m] ?? m).join(", ");
  document.querySelector("#github-login").textContent = me.user.github_login ?? t.notLinked;
  document.querySelector("#account").hidden = false;
  if (me.user.github_login) document.querySelector("#link-github")?.remove();
  await showWants();
  const list = document.querySelector("#gizlets");
  const mine = await fetch("/v1/me/gizlets", { credentials: "same-origin" }).then((r) => r.json());
  for (const g of mine.gizlets) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/${g.repo}`;
    a.textContent = g.name;
    li.append(a, ` · ${g.version ?? t.noRelease} · ${t.visibility[g.visibility] ?? g.visibility}${g.visibility_reason ? ` (${g.visibility_reason})` : ""}`);
    list.append(li);
  }
  if (!mine.gizlets.length) list.textContent = mine.github_login ? t.noGizlets : t.linkToSee;
}

/** The handhelds the user wants, each with a button to take the want back. */
async function showWants() {
  const list = document.querySelector("#wants");
  const empty = () => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "/install#handhelds";
    a.textContent = t.findHandhelds;
    li.append(`${t.noWants} `, a);
    list.replaceChildren(li);
  };
  const res = await fetch("/v1/me/wants", { credentials: "same-origin" });
  if (!res.ok) return message(fmt(t.loadFailed, { status: res.status }));
  const { wants } = await res.json();
  for (const h of wants) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    const supported = h.status === "supported";
    a.href = supported ? `/install/${h.id}` : `/install?${new URLSearchParams({ q: h.name })}#handhelds`;
    a.textContent = h.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link";
    remove.textContent = t.unwant;
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const del = await fetch(`/v1/me/wants/${encodeURIComponent(h.id)}`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
      remove.disabled = false;
      if (!del?.ok) return message(fmt(t.requestFailed, { status: del?.status ?? "?" }));
      li.remove();
      if (!list.children.length) empty();
    });
    const count = fmt(h.wants === 1 ? t.wants.one : t.wants.other, { n: h.wants });
    li.append(a, ` · ${h.maker} · ${supported ? t.supportedNow : count} `, remove);
    list.append(li);
  }
  if (!wants.length) empty();
}

document.querySelector("#link-github")?.addEventListener("click", async () => {
  try {
    const { url } = await call("/link-social", { provider: "github", callbackURL: "/account" });
    location.assign(url);
  } catch (err) {
    message(err.message);
  }
});

document.querySelector("#signout").addEventListener("click", async () => {
  await call("/sign-out", {}).catch(() => {});
  location.assign("/");
});

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

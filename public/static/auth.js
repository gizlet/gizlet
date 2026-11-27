// Shared helpers for the account pages: JSON calls to Better Auth at /api/v1/auth.

/** The page's strings in its language, from the JSON block the server writes (src/i18n.ts). */
export const t = JSON.parse(globalThis.document?.querySelector("#i18n")?.textContent ?? "{}");

/** Fill `{name}` placeholders. */
export const fmt = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export const message = (text) => {
  document.querySelector("#message").textContent = text;
};

export async function call(path, body) {
  const res = await fetch(`/api/v1/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(t.errors?.[data?.code] ?? data?.message ?? data?.error_description ?? fmt(t.requestFailed, { status: res.status }));
  return data;
}

/** A path on this site to return to, from ?next=; anything that resolves elsewhere is ignored. */
export function nextPath(fallback) {
  const next = new URLSearchParams(location.search).get("next");
  if (!next || !next.startsWith("/")) return fallback;
  let url;
  try {
    url = new URL(next, location.origin);
  } catch {
    return fallback;
  }
  return url.origin === location.origin ? url.pathname + url.search + url.hash : fallback;
}

export function signIn(next) {
  location.assign(`/login?next=${encodeURIComponent(next)}`);
}

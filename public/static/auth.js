// Shared helpers for the account pages: JSON calls to Better Auth at /v1/auth.
export const message = (text) => {
  document.querySelector("#message").textContent = text;
};

export async function call(path, body) {
  const res = await fetch(`/v1/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? data?.error_description ?? `request failed (${res.status})`);
  return data;
}

/** A same-site path to return to, from ?next=. */
export function nextPath(fallback) {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export function signIn(next) {
  location.assign(`/login?next=${encodeURIComponent(next)}`);
}

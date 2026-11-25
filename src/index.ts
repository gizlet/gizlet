import { api } from "./api";
import { dl } from "./dl";
import type { Env, MirrorJob } from "./env";
import { mirrorRelease } from "./mirror";
import { refreshStale } from "./registry";
import { site } from "./site";

/** One Worker serves every gizlet.io host; the host picks the app. */
function hostOf(req: Request, env: Env): string {
  const host = new URL(req.url).hostname;
  if (env.DEV_HOST_OVERRIDE === "1") return req.headers.get("x-gizlet-host") ?? host;
  return host;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/static/")) {
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      out.headers.set("cache-control", "public, max-age=3600");
      return out;
    }
    switch (hostOf(req, env)) {
      case "api.gizlet.io":
        return api.fetch(req, env, ctx);
      case "dl.gizlet.io":
        return dl.fetch(req, env, ctx);
      case "www.gizlet.io":
      case "store.gizlet.io":
        // The store moved to gizlet.io; old share links keep working.
        return Response.redirect(`${env.SITE_ORIGIN}${url.pathname}${url.search}`, 301);
      default:
        return site.fetch(req, env, ctx);
    }
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await mirrorRelease(env, msg.body, msg.attempts);
        msg.ack();
      } catch (e) {
        console.error("mirror failed", msg.body, e);
        msg.retry({ delaySeconds: Math.min(30 * msg.attempts, 300) });
      }
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshStale(env));
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }, MirrorJob>;

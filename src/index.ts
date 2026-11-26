import { api } from "./api";
import { dl } from "./dl";
import type { Env, MirrorJob } from "./env";
import { mirrorRelease, requeueStuck } from "./mirror";
import { refreshStale } from "./registry";
import { site } from "./site";

/** Must match the second cron in wrangler.jsonc. */
const REFRESH_CRON = "17 */6 * * *";

const HOST_PREFIX = /^\/_host\/([a-z0-9.-]+)(\/.*)?$/;

/**
 * One Worker serves every gizlet.io host; the host picks the app. Local runs
 * (DEV_HOST_OVERRIDE=1) pick it with an X-Gizlet-Host header, or with a /_host/<host>/ path
 * prefix that browsers can follow, since every local host is localhost.
 */
function route(req: Request, env: Env): { host: string; req: Request } {
  const url = new URL(req.url);
  if (env.DEV_HOST_OVERRIDE !== "1") return { host: url.hostname, req };
  const m = HOST_PREFIX.exec(url.pathname);
  if (m) {
    url.pathname = m[2] ?? "/";
    return { host: m[1]!, req: new Request(url, req) };
  }
  return { host: req.headers.get("x-gizlet-host") ?? url.hostname, req };
}

/** Account routes the site's own pages call, served on gizlet.io as on api.gizlet.io. */
const isAccountPath = (path: string) => path.startsWith("/v1/auth/") || path === "/v1/me" || path.startsWith("/v1/me/");

export default {
  async fetch(request, env, ctx) {
    const { host, req } = route(request, env);
    const url = new URL(req.url);
    if (url.pathname.startsWith("/static/")) {
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      // Fonts never change under one name; the stylesheet and scripts are revalidated on every
      // load (a 304 when unchanged), so a deploy shows at once and never pairs new pages with old CSS.
      out.headers.set("cache-control", url.pathname.startsWith("/static/fonts/") ? "public, max-age=31536000, immutable" : "no-cache");
      return out;
    }
    switch (host) {
      case "api.gizlet.io":
        return api.fetch(req, env, ctx);
      case "dl.gizlet.io":
        return dl.fetch(req, env, ctx);
      case "www.gizlet.io":
        return Response.redirect(`${env.SITE_ORIGIN}${url.pathname}${url.search}`, 301);
      default:
        if (isAccountPath(url.pathname)) return api.fetch(req, env, ctx);
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

  async scheduled(event, env, ctx) {
    // Every 10 minutes: recover releases whose mirror job was lost. Every 6 hours: new releases.
    ctx.waitUntil(requeueStuck(env));
    if (event.cron === REFRESH_CRON) ctx.waitUntil(refreshStale(env));
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }, MirrorJob>;

import { api } from "./api";
import { dl } from "./dl";
import type { Env, MirrorJob } from "./env";
import { mirrorRelease, requeueStuck } from "./mirror";
import { refreshStale } from "./registry";
import { site } from "./site";

/** Must match the second cron in wrangler.jsonc. */
const REFRESH_CRON = "17 */6 * * *";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "www.gizlet.io") return Response.redirect(`${env.SITE_ORIGIN}${url.pathname}${url.search}`, 301);
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) return api.fetch(request, env, ctx);
    if (url.pathname.startsWith("/assets/")) {
      url.pathname = url.pathname.slice("/assets".length);
      return dl.fetch(new Request(url, request), env, ctx);
    }
    // Browsers and crawlers ask for /favicon.ico whatever the page links.
    if (url.pathname === "/favicon.ico") url.pathname = "/static/favicon.ico";
    if (url.pathname.startsWith("/static/")) {
      const res = await env.ASSETS.fetch(new Request(url, request));
      const out = new Response(res.body, res);
      // Fonts never change under one name; the stylesheet and scripts are revalidated on every
      // load (a 304 when unchanged), so a deploy shows at once and never pairs new pages with old CSS.
      out.headers.set("cache-control", url.pathname.startsWith("/static/fonts/") ? "public, max-age=31536000, immutable" : "no-cache");
      return out;
    }
    return site.fetch(request, env, ctx);
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

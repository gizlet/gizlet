/**
 * A gizlet's own colour (gizlet.toml `color`) for its cartridge shell and its page. The CSP
 * allows no inline styles, so the colours a page shows come as one stylesheet,
 * /_theme/<version>/<hex>-<hex>.css, whose classes are `theme-<hex>`. It is cached for good, so
 * THEME_VERSION goes up whenever themeCss changes what it writes.
 */
import { html } from "hono/html";

/** Bump when themeCss changes: the stylesheets are cached as immutable. */
export const THEME_VERSION = "2";

/** Most colours one stylesheet carries: a page of Explore, plus room. */
export const MAX_THEMES = 48;
export const THEME_FILE = new RegExp(`^([0-9a-f]{6}(?:-[0-9a-f]{6}){0,${MAX_THEMES - 1}})\\.css$`);

const hexOf = (color: string | null | undefined) => (color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.slice(1).toLowerCase() : null);

/** The class that gives an element this colour, or null without one. */
export const themeClass = (color: string | null | undefined) => {
  const h = hexOf(color);
  return h ? `theme-${h}` : null;
};

/** The stylesheet for these colours, or null when none has one. */
export function themeHref(colors: (string | null | undefined)[]): string | null {
  const hexes = [...new Set(colors.map(hexOf).filter((h): h is string => !!h))].sort().slice(0, MAX_THEMES);
  return hexes.length ? `/_theme/${THEME_VERSION}/${hexes.join("-")}.css` : null;
}

/** A <link> to the stylesheet for these colours, for pages that render cartridges in their body. */
export function themeLink(colors: (string | null | undefined)[]) {
  const href = themeHref(colors);
  return href ? html`<link rel="stylesheet" href="${href}">` : "";
}

/** `--c` colours a cartridge shell; `--g` a gizlet's page; `--g-on` is text that reads on `--c`. */
export function themeCss(hexes: string[]): string {
  return hexes
    .map((hex) => {
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
      return `.theme-${hex} { --c: #${hex}; --g: #${hex}; --g-on: ${luminance > 0.3 ? "#101114" : "#ffffff"}; }\n`;
    })
    .join("");
}

/**
 * Pattern tiles (gizlet.toml `pattern`) for cartridge shells and a gizlet's page band. One
 * stylesheet per page, /_patterns.css?r=<repo>&r=..., looks each repository's tile up, so the
 * URLs come from the registry and never from the request.
 */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

/** The class that sets `--pattern` for a repository's tile. */
export const patternClass = (repo: string) => `pat-${fnv(repo)}`;

/** Classes for an element showing a gizlet's pattern, or "" without one. */
export const patternClasses = (g: { repo: string; pattern_url?: string | null }) => (g.pattern_url ? ` has-pattern ${patternClass(g.repo)}` : "");

export function patternHref(gizlets: ({ repo: string; pattern_url?: string | null } | null | undefined)[]): string | null {
  const repos = [...new Set(gizlets.filter((g) => g?.pattern_url).map((g) => g!.repo))].sort().slice(0, MAX_THEMES);
  return repos.length ? `/_patterns.css?${repos.map((r) => `r=${encodeURIComponent(r)}`).join("&")}` : null;
}

export function patternLink(gizlets: ({ repo: string; pattern_url?: string | null } | null | undefined)[]) {
  const href = patternHref(gizlets);
  return href ? html`<link rel="stylesheet" href="${href}">` : "";
}

/** `--pattern`: the tile at 2x, so a 512 px tile repeats every 256 CSS pixels and stays sharp. */
export const patternRule = (repo: string, url: string) => `.${patternClass(repo)} { --pattern: image-set(url(${JSON.stringify(url)}) 2x); }\n`;

/**
 * The Gizlet mark, inline so its cursor can blink: a cobalt handheld, tilted like the
 * cartridges, whose dark screen shows a sun g and a white cursor, as at a shell prompt.
 * public/static/icon.svg and design/icon/ are the same drawing; design/README.md describes it.
 */
import { raw } from "hono/html";

const SUN = "#ffd23a";
const G = `<g fill="none" stroke="${SUN}" stroke-width="3.85"><circle cx="27" cy="18" r="5.6"/><path d="M32.6 11.7V25Q32.6 31.3 26.3 31.3H22.1"/></g>`;
const cursor = `<rect class="cur" x="37" y="29.5" width="9" height="4" rx="1" fill="#fff"/>`;

/** The whole mark, for the header and footer. */
export const mark = raw(
  `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(-8 32 32)">` +
    `<rect x="10" y="2" width="44" height="60" rx="10" fill="#2b45ff"/><rect x="15" y="7" width="34" height="30" rx="5" fill="#101114"/>${G}${cursor}` +
    `<path d="M23 42h4v4h4v4h-4v4h-4v-4h-4v-4h4z" fill="#fff"/><circle cx="42" cy="51" r="3.3" fill="${SUN}"/><circle cx="47.5" cy="44" r="3.3" fill="#fff"/></g></svg>`,
);

/** Just the screen's g and cursor, for the boot screen of the handhelds drawn on the site. */
export const prompt = raw(`<svg class="prompt" viewBox="19 9 28 26" aria-hidden="true" focusable="false">${G}${cursor}</svg>`);

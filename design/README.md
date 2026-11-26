# Design

`cartridge.html` was the first direction (warm paper, signal orange, heavy grotesk, gizlets as cartridges). The site keeps the cartridges but moved to cool grey, cobalt and sun yellow, with handhelds drawn in CSS (`public/static/site.css`). Type is Schibsted Grotesk, self-hosted in `public/static/fonts/` (SIL OFL), on English pages; Chinese and Japanese pages use the system CJK face for Latin too, so mixed lines match.

## Icon

A cobalt (`#2b45ff`) handheld, tilted like the cartridges, whose dark (`#101114`) screen shows a sun yellow (`#ffd23a`) g and a white cursor, as at a shell prompt: a pocket Linux computer. It is all colour, so it holds on white, the site's grey and dark tabs without a dark-mode variant. Where a background is required, it is white.

On the site the mark is inline (`src/mark.ts`), so the cursor can blink: in the header when the logo is hovered, and always on the boot screen of the handhelds drawn in CSS, which show only the g and cursor. Neither moves under `prefers-reduced-motion`.

| File | Use |
| --- | --- |
| `icon/mark.svg` | The mark, transparent (the workflow templates in gizlet/.github use it) |
| `icon/on-white.svg`, `icon/avatar.png` | On white, 1024 px: the GitHub organization avatar |
| `public/static/icon.svg` | Favicon, the same drawing as `icon/mark.svg` |
| `public/static/favicon.ico` | 16, 32 and 48 px PNGs of `icon.svg` |
| `public/static/apple-touch-icon.png` | `on-white.svg` at 180 px |

`src/mark.ts` repeats the drawing; change it together with the SVG files. PNGs are rendered from the SVGs in headless Chromium.

## What the site leaves out

Generated sites share a set of visual defaults, and several together make a page read as a template ([avoid-ai-design](https://github.com/funboy322/avoid-ai-design), [Tells of a Slop UI](https://news.ycombinator.com/item?id=49867038)). The cartridge direction sits close to the "tasteful" set (cream and orange, heavy shadows), so the cartridges are the one loud element and the rest stays plain:

- **Type**: sentence case as written; all caps and monospace only on cartridge labels (and code). No pill or rotated stamps, no single coloured word in a headline.
- **Surface**: flat paper, no dot or grid backgrounds. Hard offset shadows, tilt and hover lift only on cartridges. One radius (8px) for everything else.
- **Layout**: no rows of cards with 01/02/03 numbering; steps are rows with the title beside the text.

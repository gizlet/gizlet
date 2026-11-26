# Design

`cartridge.html` was the first direction (warm paper, signal orange, heavy grotesk, gizlets as cartridges). The site keeps the cartridges but moved to cool grey, cobalt and sun yellow, with handhelds drawn in CSS (`public/static/site.css`). Type is Schibsted Grotesk, self-hosted in `public/static/fonts/` (SIL OFL), on English pages; Chinese and Japanese pages use the system CJK face for Latin too, so mixed lines match.

## Icon

A lowercase g whose bowl is a rounded square, a handheld, with a sun yellow (`#ffd23a`) screen in it; the g is ink (`#101114`). It has no background of its own, so it sits on white, the site's grey or any light surface. Where a background is required, it is white. The bowl is square and the tail turns a rounded corner and ends flat, to keep it apart from Galp's round orange g and Gojek's ring and dot.

| File | Use |
| --- | --- |
| `icon/mark.svg` | The mark, transparent, screen in a gap like a bezel (the workflow templates in gizlet/.github use it) |
| `icon/on-white.svg`, `icon/avatar.png` | On white, 1024 px: the GitHub organization avatar |
| `public/static/icon.svg` | Favicon: no gap, since it closes up below 48 px |
| `public/static/favicon.ico` | 16, 32 and 48 px PNGs of `icon.svg`, ink only |
| `public/static/apple-touch-icon.png` | `on-white.svg` at 180 px |

The SVG marks turn the g white when the viewer is in dark mode (`prefers-color-scheme`), so the favicon stays visible in dark tabs; the PNGs and the ICO cannot. PNGs are rendered from the SVGs in headless Chromium.

## What the site leaves out

Generated sites share a set of visual defaults, and several together make a page read as a template ([avoid-ai-design](https://github.com/funboy322/avoid-ai-design), [Tells of a Slop UI](https://news.ycombinator.com/item?id=49867038)). The cartridge direction sits close to the "tasteful" set (cream and orange, heavy shadows), so the cartridges are the one loud element and the rest stays plain:

- **Type**: sentence case as written; all caps and monospace only on cartridge labels (and code). No pill or rotated stamps, no single coloured word in a headline.
- **Surface**: flat paper, no dot or grid backgrounds. Hard offset shadows, tilt and hover lift only on cartridges. One radius (8px) for everything else.
- **Layout**: no rows of cards with 01/02/03 numbering; steps are rows with the title beside the text.

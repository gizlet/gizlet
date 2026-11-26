# Design

`cartridge.html` was the first direction (warm paper, signal orange, heavy grotesk, gizlets as cartridges). The site keeps the cartridges but moved to cool grey, cobalt and sun yellow, with handhelds drawn in CSS (`public/static/site.css`). Type is Schibsted Grotesk, self-hosted in `public/static/fonts/` (SIL OFL), on English pages; Chinese and Japanese pages use the system CJK face for Latin too, so mixed lines match.

## What the site leaves out

Generated sites share a set of visual defaults, and several together make a page read as a template ([avoid-ai-design](https://github.com/funboy322/avoid-ai-design), [Tells of a Slop UI](https://news.ycombinator.com/item?id=49867038)). The cartridge direction sits close to the "tasteful" set (cream and orange, heavy shadows), so the cartridges are the one loud element and the rest stays plain:

- **Type**: sentence case as written; all caps and monospace only on cartridge labels (and code). No pill or rotated stamps, no single coloured word in a headline.
- **Surface**: flat paper, no dot or grid backgrounds. Hard offset shadows, tilt and hover lift only on cartridges. One radius (8px) for everything else.
- **Layout**: no rows of cards with 01/02/03 numbering; steps are rows with the title beside the text.

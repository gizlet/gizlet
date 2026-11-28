import { html } from "hono/html";

type IconName = "arrow-left" | "arrow-right" | "caret-down" | "check" | "circle" | "desktop" |
  "envelope-simple" | "file" | "folder" | "game-controller" | "github-logo" | "globe" | "heart" | "laptop" | "magnifying-glass" | "play" | "plus";

export function icon(name: IconName) {
  return html`<span class="ph-icon ph-${name}" aria-hidden="true"></span>`;
}

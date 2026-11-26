# gizlet.toml and manifest.json

A gizlet is described by one file its developer writes, `gizlet.toml` at the root of its repository. Its build generates `manifest.json` inside each `.gzl` package from it. Nothing else describes a gizlet: the registry reads `gizlet.toml` at the release's tag, and a device reads only the package's `manifest.json`.

| File | Written by | Where | Read by |
| --- | --- | --- | --- |
| `gizlet.toml` | The developer | Repository root, at the release tag | The build, and the registry (the store page, search, which packages exist) |
| `manifest.json` | The build | Root of each `.gzl` | The device (installing and running), and the registry's checks |

A worked example is [tests/fixtures/repos/rocket-snail/gizlet.toml](../tests/fixtures/repos/rocket-snail/gizlet.toml). The parser is `parseGizletToml` in [src/schema.ts](../src/schema.ts).

## gizlet.toml

```toml
id = "io.gizlet.rocket-snail"
name = "Rocket Snail"
version = "0.1.0"
category = "game"
description = "The slowest racer in the galaxy straps on a rocket."
tags = ["racing", "space", "arcade"]
color = "#7b4dff"
license = "MIT"
runtime = 1
icon = "store/icon.png"
cover = "store/cover.jpg"
pattern = "store/pattern.png"
screenshots = ["store/screenshots/planet.jpg", "store/screenshots/slingshot.jpg"]

[names]
zh-CN = "火箭蜗牛"

[descriptions]
zh-CN = "银河系最慢的赛车手绑上了火箭。"

[links]
website = "https://rocket-snail.example"
x = "https://x.com/rocketsnail"
discord = "https://discord.gg/rocketsnail"

[about]
en = "store/about.en.md"
zh-CN = "store/about.zh-CN.md"

[[controls]]
button = "a"
action = "Fire the rocket"
actions = { zh-CN = "点火加速" }

[[packages]]
target = "aarch64-unknown-linux-gnu"
tier = "lite"
entry = "bin/rocket-snail"
```

### Fields

| Field | Required | Rules |
| --- | --- | --- |
| `id` | yes | Reverse-DNS, lowercase: `io.gizlet.rocket-snail`. Never changes; a device keeps saves under it |
| `name` | yes | At most 80 characters |
| `version` | yes | The release tag must be `v<version>` |
| `category` | no | `game` or `app`; `app` if left out |
| `description` | no | One or two sentences, at most 500 characters. Without one the gizlet stays unlisted |
| `tags` | no | At most 12, each at most 32 characters, stored lowercase |
| `color` | no | `#RRGGBB`: the gizlet's own colour, for its cartridge on the store's shelves, its page and the launcher. Without one, the store picks one of five shell colours per repository |
| `license` | no | An SPDX expression (`MIT`, `Apache-2.0 OR MIT`), at most 64 characters |
| `runtime` | no | The Gizlet runtime a dynamically linked entry needs; `1`, the only one today, if left out |
| `icon` | no | Repository path of a square PNG, JPEG or WebP, at least 256×256. Without one the gizlet stays unlisted |
| `cover` | no | Repository path of a 16:9 image, at least 1280×720: the top of the store page |
| `pattern` | no | Repository path of a square PNG or WebP tile with transparency, 512×512, repeated over `color` across the top of the gizlet's page (every 256 CSS pixels) and on its cartridge's shell (every 128). Keep it faint and light (a few tens of KB): the page's text sits on the left, over a scrim |
| `screenshots` | no | Up to 8 repository paths of 4:3 images: real captures of the game, at the handheld's own 640×480 (or 1280×960 from a desktop build). Not renders or key art; that belongs in `cover` |
| `[names]`, `[descriptions]` | no | `name` and `description` per language tag (`zh-CN`, `ja`, ...) |
| `[links]` | no | The developer's site and accounts, shown on the gizlet's page: `website`, `x`, `bluesky`, `mastodon`, `youtube`, `twitch`, `discord`, `bilibili`, `weibo`, `xiaohongshu`, `itch`, `steam`, `patreon`, `kofi`, `afdian`. Each is an `https://` URL of at most 300 characters; except for `website` and `mastodon`, it must be on that service's own domain (`x` on x.com or twitter.com, `discord` on discord.gg or discord.com, ...) |
| `[about]` | no | Per language tag, the repository path of a Markdown file: the long description on the store page |
| `[[controls]]` | no | Up to 12: `button` (`dpad`, `a`, `b`, `x`, `y`, `l`, `r`, `start`, `select`), `action` (at most 60 characters) and `actions` per language |
| `[[packages]]` | yes | 1 to 32 packages, below |

Unknown keys are refused, so a misspelt field is an error rather than silently ignored.

Repository paths are relative to the repository root, `/`-separated, with no empty, `.` or `..` parts, and each part made of letters, digits and `._+-`. The registry reads them at the release tag and mirrors them, at most 10 MiB each. Art may be anywhere in the repository; `store/` is the convention.

### Packages

```toml
[[packages]]
target = "aarch64-unknown-linux-gnu"
tier = "lite"
entry = "bin/rocket-snail"
```

| Field | Rules |
| --- | --- |
| `target` | A target triple: `aarch64-unknown-linux-gnu`, `aarch64-unknown-linux-musl`, `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`, ... |
| `tier` | `lite` (runs on every device) or `full` (needs a full-tier device) |
| `entry` | The executable's path inside the package, a canonical relative path |

Each `target` and `tier` pair appears once. Its package is the release asset named

```
<id>-<version>-<target>-<tier>.gzl
```

for example `io.gizlet.rocket-snail-0.1.0-aarch64-unknown-linux-gnu-lite.gzl`. The registry finds packages by that name, so it needs no GitHub API. It learns their size and sha256 while it mirrors them; a release becomes installable once every package is mirrored and checked.

## manifest.json

The build writes it at the root of each `.gzl`, beside `CHECKSUMS` (the SHA-256 of every other file in the package, one `<hex>  <path>` line each). It is `gizlet.toml`'s device-facing fields plus the package's own `target`, `tier` and `entry`:

```json
{
  "schema": 1,
  "id": "io.gizlet.rocket-snail",
  "name": "Rocket Snail",
  "names": { "zh-CN": "火箭蜗牛" },
  "version": "0.1.0",
  "description": "The slowest racer in the galaxy straps on a rocket.",
  "descriptions": { "zh-CN": "银河系最慢的赛车手绑上了火箭。" },
  "color": "#7b4dff",
  "runtime": 1,
  "target": "aarch64-unknown-linux-gnu",
  "tier": "lite",
  "entry": "bin/rocket-snail",
  "icon": "icon.png"
}
```

`icon` is a path inside the package (the build copies `gizlet.toml`'s icon there); the other fields have the same names and rules as in `gizlet.toml`. Store-only fields (`category`, `tags`, `cover`, `screenshots`, `about`, `controls`, `license`) are left out.

The registry fails a package whose `manifest.json` is missing, is not a JSON object, or differs from `gizlet.toml` in `id`, `name`, `version`, `runtime`, `target`, `tier` or `entry`, and one whose `entry` is not an executable for its target.

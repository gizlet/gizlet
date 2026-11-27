# What the launcher's Store uses: art as PNGs at the sizes it draws, home lists of what the
# device can install, and one request that says which installed gizlets have updates.

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.device_icon_url" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/~device/icon.png"
jsonpath "$.device_cover_url" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/~device/cover.png"
jsonpath "$.device_screenshots" count == 1
jsonpath "$.device_screenshots[0]" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/~device/screenshot-1.png"

# Each is a PNG of its size, whatever the art was: the IHDR chunk holds the width and height.
GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/~device/icon.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "content-type" == "image/png"
bytes startsWith hex,89504e470d0a1a0a0000000d494844520000008000000080;

GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/~device/cover.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
bytes startsWith hex,89504e470d0a1a0a0000000d494844520000028000000168;

GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/~device/screenshot-1.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
bytes startsWith hex,89504e470d0a1a0a0000000d4948445200000280000001e0;

# A JPEG cover and screenshots become PNGs too.
GET {{base}}/v1/gizlets/github.com/fixture-org/rocket-snail
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/rocket-snail/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/github.com/fixture-org/rocket-snail/v0.1.0/~device/cover.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "content-type" == "image/png"
bytes startsWith hex,89504e470d0a1a0a0000000d494844520000028000000168;

GET {{base}}/github.com/fixture-org/rocket-snail/v0.1.0/~device/screenshot-2.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
bytes startsWith hex,89504e470d0a1a0a0000000d4948445200000280000001e0;

# Only the art gizlet.toml names.
GET {{base}}/github.com/fixture-org/rocket-snail/v0.1.0/~device/screenshot-9.png
x-gizlet-host: dl.gizlet.io
HTTP 404

GET {{base}}/github.com/fixture-org/rocket-snail/v0.1.0/~device/pattern.png
x-gizlet-host: dl.gizlet.io
HTTP 404

GET {{base}}/github.com/fixture-org/rocket-snail/v9.9.9/~device/icon.png
x-gizlet-host: dl.gizlet.io
HTTP 404

# Home lists for a handheld: apps with a package for its target and tier.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/clock-service
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/clock-service/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/clock-service/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200

GET {{base}}/v1/featured?kind=app&target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')]" count > 0
jsonpath "$.sections[*].gizlets[?(@.kind == 'service')]" not exists
jsonpath "$.sections[?(@.id == 'services')]" not exists
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/clock-service')]" not exists

GET {{base}}/v1/featured?kind=service&target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/clock-service')]" count > 0
jsonpath "$.sections[*].gizlets[?(@.kind == 'app')]" not exists

# No listed gizlet has a package for this target.
GET {{base}}/v1/featured?target=riscv64gc-unknown-linux-gnu
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections" count == 0
jsonpath "$.hero" count == 0

GET {{base}}/v1/featured?kind=widget
x-gizlet-host: api.gizlet.io
HTTP 400

# The target and the tier must fit the same package.
GET {{base}}/v1/gizlets/github.com/fixture-org/mixed-tiers
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/mixed-tiers/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/mixed-tiers/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200

GET {{base}}/v1/featured?kind=app&target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/mixed-tiers')]" not exists
jsonpath "$.hero[?(@.repo == 'github.com/fixture-org/mixed-tiers')]" not exists

GET {{base}}/v1/gizlets?kind=app&target=aarch64-unknown-linux-gnu&tier=lite&q=mixed
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/v1/featured?kind=app&target=aarch64-unknown-linux-gnu&tier=full
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/mixed-tiers')]" exists

GET {{base}}/v1/gizlets?kind=app&target=x86_64-unknown-linux-gnu&tier=lite&q=mixed
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/mixed-tiers/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200

GET {{base}}/v1/featured?tier=huge
x-gizlet-host: api.gizlet.io
HTTP 400

# Updates: only from the repository the app came from, and only with its id.
GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
hello_repository_id: jsonpath "$.repository_id"
[Asserts]
jsonpath "$.repository_id" isInteger

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{
  "target": "aarch64-unknown-linux-gnu",
  "tier": "lite",
  "installed": [
    {"repo": "github.com/fixture-org/hello-gizlet", "repository_id": {{hello_repository_id}}, "id": "dev.fixture.hellogizlet", "version": "0.1.0"},
    {"repo": "https://github.com/Fixture-Org/hello-gizlet", "repository_id": {{hello_repository_id}}, "id": "dev.fixture.hellogizlet", "version": "0.2.0"},
    {"repo": "github.com/fixture-org/hello-gizlet", "repository_id": {{hello_repository_id}}, "id": "dev.someone.else", "version": "0.1.0"},
    {"repo": "github.com/fixture-org/on-demand", "id": "dev.fixture.ondemand", "version": "0.1.0"},
    {"repo": "github.com/fixture-org/never-published", "id": "dev.fixture.never", "version": "1.0.0"},
    {"repo": "not a repository", "id": "dev.fixture.never", "version": "1.0.0"}
  ]
}
HTTP 200
[Asserts]
header "cache-control" == "no-store"
jsonpath "$.gizlets" count == 6
jsonpath "$.gizlets[0].status" == "update"
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.gizlets[0].installed" == "0.1.0"
jsonpath "$.gizlets[0].repository_id" == {{hello_repository_id}}
jsonpath "$.gizlets[0].version" == "0.2.0"
jsonpath "$.gizlets[0].tag" == "v0.2.0"
jsonpath "$.gizlets[0].kind" == "app"
jsonpath "$.gizlets[0].name" == "Hello Gizlet"
jsonpath "$.gizlets[0].names['zh-CN']" == "你好 Gizlet"
jsonpath "$.gizlets[0].visibility" == "listed"
jsonpath "$.gizlets[0].device_icon_url" endsWith "/v0.2.0/~device/icon.png"
jsonpath "$.gizlets[0].package.tier" == "lite"
jsonpath "$.gizlets[0].package.url" contains "?sha256="
jsonpath "$.gizlets[1].status" == "current"
jsonpath "$.gizlets[1].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.gizlets[1].package" not exists
jsonpath "$.gizlets[2].status" == "id_changed"
jsonpath "$.gizlets[2].package" not exists
# Installed without GitHub's id for its repository: updated only by installing it again.
jsonpath "$.gizlets[3].status" == "unverified"
jsonpath "$.gizlets[3].package" not exists
jsonpath "$.gizlets[4].status" == "not_found"
jsonpath "$.gizlets[5].status" == "not_found"

# Nothing for this target any more.
POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "riscv64gc-unknown-linux-gnu", "installed": [{"repo": "github.com/fixture-org/hello-gizlet", "repository_id": {{hello_repository_id}}, "id": "dev.fixture.hellogizlet", "version": "0.1.0"}]}
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].status" == "no_package"

# The path now holds another GitHub repository than the one the app came from: no update.
POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "aarch64-unknown-linux-gnu", "installed": [{"repo": "github.com/fixture-org/hello-gizlet", "repository_id": 1, "id": "dev.fixture.hellogizlet", "version": "0.1.0"}]}
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].status" == "repository_changed"
jsonpath "$.gizlets[0].package" not exists

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "aarch64-unknown-linux-gnu", "installed": [{"repo": "github.com/fixture-org/hello-gizlet", "repository_id": "1", "id": "dev.fixture.hellogizlet", "version": "0.1.0"}]}
HTTP 400

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "nope", "installed": []}
HTTP 400

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "aarch64-unknown-linux-gnu", "installed": [{"repo": "github.com/fixture-org/hello-gizlet"}]}
HTTP 400

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "aarch64-unknown-linux-gnu"}
HTTP 400

# A gizlet read from the public web learns GitHub's repository id when a device installs it. When
# another repository takes its path and publishes a higher version with the same app id, devices
# that installed the first never get it as an update, and its release is not offered in its name.
GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

# Read from the public web, so its release is indexed and mirrored again under the id first.
GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Captures]
first_repository_id: jsonpath "$.repository_id"
[Asserts]
jsonpath "$.repository_id" isInteger
jsonpath "$.version" == "1.0.0"

POST {{fixture}}/_fixture/replace?repo=fixture-org/path-reuse
HTTP 200

POST {{fixture}}/_fixture/release?repo=fixture-org/path-reuse&version=2.0.0
HTTP 201

GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse/releases/v2.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{"target": "aarch64-unknown-linux-gnu", "installed": [{"repo": "github.com/fixture-org/path-reuse", "repository_id": {{first_repository_id}}, "id": "dev.fixture.pathreuse", "version": "1.0.0"}]}
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].status" == "repository_changed"
jsonpath "$.gizlets[0].package" not exists

GET {{base}}/v1/gizlets/github.com/fixture-org/path-reuse/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.version" == "2.0.0"
jsonpath "$.repository_id" != {{first_repository_id}}

# A repository created again at the same path with the very same release is indexed again from the
# new repository, so its release is offered under the new repository's id rather than dropped.
GET {{base}}/v1/gizlets/github.com/fixture-org/recreated
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/recreated/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Captures]
old_recreated_id: jsonpath "$.repository_id"
[Asserts]
jsonpath "$.repository_id" isInteger
jsonpath "$.id" == "dev.fixture.recreated"

POST {{fixture}}/_fixture/replace?repo=fixture-org/recreated
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/recreated
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/recreated/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.version" == "1.0.0"
jsonpath "$.repository_id" != {{old_recreated_id}}

# Another repository takes the path while a release is being mirrored: the files read by path may
# be the newcomer's, so the release fails rather than being offered under the first one's id.
POST {{fixture}}/_fixture/hold?repo=fixture-org/takeover
HTTP 200

GET {{fixture}}/token?repo=fixture-org/takeover&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
takeover_token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{takeover_token}}
{}
HTTP 202

GET {{base}}/v1/gizlets/github.com/fixture-org/takeover/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "mirroring"

POST {{fixture}}/_fixture/replace?repo=fixture-org/takeover
HTTP 200

POST {{fixture}}/_fixture/release-hold?repo=fixture-org/takeover
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/takeover/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "no longer the GitHub repository v1.0.0 was indexed from"

# A gizlet read from the public web: mirroring checks which repository the path holds before the
# first file and after the last, and pins its release to it. When another repository takes the
# path before anyone installs it, the release stays the first one's, and the newcomer's is indexed
# under its own id once a refresh sees the change.
GET {{base}}/v1/gizlets/github.com/fixture-org/early-reuse
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/early-reuse/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{fixture}}/_fixture/replace?repo=fixture-org/early-reuse
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/early-reuse/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
early_first_id: jsonpath "$.repository_id"
[Asserts]
jsonpath "$.repository_id" isInteger

GET {{base}}/v1/gizlets/github.com/fixture-org/early-reuse
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/early-reuse/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.repository_id" isInteger
jsonpath "$.repository_id" != {{early_first_id}}

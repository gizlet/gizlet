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

POST {{base}}/v1/updates
x-gizlet-host: api.gizlet.io
{
  "target": "aarch64-unknown-linux-gnu",
  "tier": "lite",
  "installed": [
    {"repo": "github.com/fixture-org/hello-gizlet", "id": "dev.fixture.hellogizlet", "version": "0.1.0"},
    {"repo": "https://github.com/Fixture-Org/hello-gizlet", "id": "dev.fixture.hellogizlet", "version": "0.2.0"},
    {"repo": "github.com/fixture-org/hello-gizlet", "id": "dev.someone.else", "version": "0.1.0"},
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
jsonpath "$.gizlets[3].status" == "no_package"
jsonpath "$.gizlets[4].status" == "not_found"
jsonpath "$.gizlets[5].status" == "not_found"

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

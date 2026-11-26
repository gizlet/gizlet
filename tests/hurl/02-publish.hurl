# Publishing with a GitHub Actions OIDC token, then mirroring and the static checks.
GET {{fixture}}/token?repo=fixture-org/hello-gizlet&ref=refs/tags/v0.1.0
HTTP 200
[Captures]
token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{token}}
{}
HTTP 202
[Captures]
status_url: jsonpath "$.status_url"
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.tag" == "v0.1.0"
jsonpath "$.status" == "pending"
jsonpath "$.share_url" == "{{site}}/github.com/fixture-org/hello-gizlet"

# The queue mirrors the packages, verifies their checksums and checks them.
GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.warnings" count == 0
jsonpath "$.mirrored" == true
jsonpath "$.packages" count == 3
jsonpath "$.packages[0].sha256" matches /^[0-9a-f]{64}$/
jsonpath "$.packages[0].size" > 0
jsonpath "$.visibility" == "unlisted"
jsonpath "$.visibility_reason" == "awaiting editorial approval"
header "cache-control" == "no-store"

# Passing the checks is not enough to be listed: an editor approves it first.
GET {{base}}/v1/gizlets?q=hello
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "listed"
jsonpath "$.visibility_reason" == null
jsonpath "$.locked" == true

# The newer release, published by tag in the body.
GET {{fixture}}/token?repo=fixture-org/hello-gizlet&ref=refs/heads/main
HTTP 200
[Captures]
token2: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{token2}}
{"tag": "v0.2.0"}
HTTP 202

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
jsonpath "$.name" == "Hello Gizlet"
jsonpath "$.version" == "0.2.0"
jsonpath "$.visibility" == "listed"
jsonpath "$.packages" count == 3
jsonpath "$.icon_url" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/store/icon.png"
jsonpath "$.packages[0].entry" == "game"

# Approved gizlets stay listed through new releases, and are searchable.
GET {{base}}/v1/gizlets?q=hello
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.gizlets[0].kind" == "app"
jsonpath "$.gizlets[0].category" == "game"

# A tag with no gizlet.toml is refused.
GET {{fixture}}/token?repo=fixture-org/hello-gizlet&ref=refs/tags/v9.9.9
HTTP 200
[Captures]
token3: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{token3}}
{}
HTTP 404
[Asserts]
jsonpath "$.error.message" contains "has no gizlet.toml at v9.9.9"

# Art must be images: a gizlet.toml that names a package as its icon is refused.
GET {{fixture}}/token?repo=fixture-org/gzl-icon&ref=refs/tags/v0.1.0
HTTP 200
[Captures]
token4: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{token4}}
{}
HTTP 422
[Asserts]
jsonpath "$.error.code" == "invalid_index"
jsonpath "$.error.message" contains "icon must be a .png, .jpg or .webp file"

# Broken releases fail their checks and are not served.
# A package gizlet.toml lists must be in the release.
GET {{base}}/v1/gizlets/github.com/fixture-org/missing-package
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/missing-package/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "dev.fixture.missingpackage-0.1.0-aarch64-unknown-linux-gnu-lite.gzl is missing from the GitHub release"

# A package's manifest.json must match gizlet.toml.
GET {{base}}/v1/gizlets/github.com/fixture-org/mismatch
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/mismatch/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "manifest.json has tier \"full\", gizlet.toml says \"lite\""

GET {{base}}/v1/gizlets/github.com/fixture-org/symlink
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/symlink/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "symbolic link"

GET {{base}}/v1/gizlets/github.com/fixture-org/setuid
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/setuid/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "setuid"

GET {{base}}/v1/gizlets/github.com/fixture-org/wrong-arch
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/wrong-arch/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "ELF machine 62, not aarch64"

GET {{base}}/v1/gizlets/github.com/fixture-org/traversal
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/traversal/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "unsafe path"

# Paths that alias another entry once extracted fail too.
GET {{base}}/v1/gizlets/github.com/fixture-org/alias
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/alias/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "\"./game\": it is not canonical"

GET {{base}}/v1/gizlets/github.com/fixture-org/case
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/case/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "extract to the same place"

GET {{base}}/v1/gizlets/github.com/fixture-org/unicode-path
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/unicode-path/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "renames it (Unicode Path)"

# A gizlet.toml with TOML literal strings is valid.
GET {{base}}/v1/gizlets/github.com/fixture-org/literal-toml
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/literal-toml/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

# Failed gizlets have nothing to install.
GET {{base}}/v1/gizlets/github.com/fixture-org/symlink/install?target=aarch64-unknown-linux-gnu
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.code" == "failed_checks"
jsonpath "$.error.message" contains "symbolic link"

# A gizlet without an icon or description is installable but stays unlisted.
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
jsonpath "$.warnings" contains "gizlet.toml names no icon"
jsonpath "$.visibility" == "unlisted"
jsonpath "$.visibility_reason" contains "no description"

GET {{base}}/v1/gizlets?q=on-demand
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand/install?target=x86_64-unknown-linux-gnu&tier=full
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.version" == "1.0.0"

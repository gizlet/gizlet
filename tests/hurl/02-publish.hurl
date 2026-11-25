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
jsonpath "$.visibility" == "listed"
header "cache-control" == "no-store"

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
jsonpath "$.icon_url" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/icon.png"

# Listed gizlets are searchable.
GET {{base}}/v1/gizlets?q=hello
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

# A tag that does not match gizlet.json's version is refused.
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
jsonpath "$.error.message" contains "no gizlet.json"

# Broken releases fail their checks and are not served.
GET {{base}}/v1/gizlets/github.com/fixture-org/bad-sum
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/bad-sum/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "sha256"

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

# A manifest.toml with TOML literal strings is valid.
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
jsonpath "$.warnings" contains "gizlet.json names no icon"
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

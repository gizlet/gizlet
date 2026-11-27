# Installing on a device and downloading packages.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200
[Captures]
url: jsonpath "$.package.url"
sha: jsonpath "$.package.sha256"
[Asserts]
jsonpath "$.version" == "0.2.0"
jsonpath "$.package.tier" == "lite"
jsonpath "$.package.url" == "https://gizlet.io/assets/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl?sha256={{sha}}"

# A full desktop prefers its own tier.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=aarch64-apple-darwin&tier=full
HTTP 200
[Asserts]
jsonpath "$.package.tier" == "full"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=riscv64gc-unknown-linux-gnu
HTTP 404
[Asserts]
jsonpath "$.error.code" == "no_compatible_package"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=nope
HTTP 400

# Packages come from R2 with their checksum, and resume with Range. A URL that names the
# sha256 is immutable; a plain one, whose bytes a republished tag can change, is not.
GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl?sha256={{sha}}
HTTP 200
[Asserts]
header "content-type" == "application/vnd.gizlet.package+zip"
header "cache-control" == "public, max-age=0, must-revalidate"
header "x-checksum-sha256" == "{{sha}}"

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl?sha256=0000000000000000000000000000000000000000000000000000000000000000
HTTP 404
[Asserts]
body contains "has changed"

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl
HTTP 200
[Asserts]
header "content-type" == "application/vnd.gizlet.package+zip"
header "cache-control" == "public, max-age=0, must-revalidate"
header "x-checksum-sha256" == "{{sha}}"
sha256 toHex == "{{sha}}"

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl
Range: bytes=0-3
HTTP 206
[Asserts]
header "content-range" matches /^bytes 0-3\/\d+$/
bytes count == 4

# The short link picks the newest compatible package.
GET {{base}}/assets/github.com/fixture-org/hello-gizlet?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 302
[Asserts]
header "Location" replace "{{base}}" "https://gizlet.io" == "{{url}}"

GET {{base}}/assets/github.com/fixture-org/hello-gizlet
HTTP 302
[Asserts]
header "Location" == "{{site}}/github.com/fixture-org/hello-gizlet"

# Files the release index does not name are never served, though they are in the GitHub release.
GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/unsafe.gzl
HTTP 404

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/gizlet.toml
HTTP 404

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/README.md
HTTP 404

# Packages of failed releases are never served, not even from GitHub.
GET {{base}}/assets/github.com/fixture-org/symlink/v0.1.0/dev.fixture.symlink-0.1.0-aarch64-unknown-linux-gnu-lite.gzl
HTTP 410

# Older mirrored releases are still served; art comes from R2 too.
GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/store/icon.png
HTTP 200
[Asserts]
header "content-type" == "image/png"
header "x-checksum-sha256" not exists

GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/store/about.en.md
HTTP 200
[Asserts]
body contains "Serve yourself **sushi**"

# Paths that leave the repository are never art.
GET {{base}}/assets/github.com/fixture-org/hello-gizlet/v0.2.0/store/../gizlet.toml
HTTP 404

GET {{base}}/assets/github.com/fixture-org/unknown/v1.0.0/x.gzl
HTTP 404

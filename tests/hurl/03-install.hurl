# Installing on a device and downloading packages.
GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
url: jsonpath "$.package.url"
sha: jsonpath "$.package.sha256"
[Asserts]
jsonpath "$.version" == "0.2.0"
jsonpath "$.package.tier" == "lite"
jsonpath "$.package.url" == "https://dl.gizlet.io/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl"

# A full desktop prefers its own tier.
GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=aarch64-apple-darwin&tier=full
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.package.tier" == "full"

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=riscv64gc-unknown-linux-gnu
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.code" == "no_compatible_package"

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/install?target=nope
x-gizlet-host: api.gizlet.io
HTTP 400

# Packages come from R2, immutable, with their checksum, and resume with Range.
GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "content-type" == "application/vnd.gizlet.package+zip"
header "cache-control" contains "immutable"
header "x-checksum-sha256" == "{{sha}}"
sha256 toHex == "{{sha}}"

GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/dev.fixture.hellogizlet-0.2.0-aarch64-unknown-linux-gnu-lite.gzl
x-gizlet-host: dl.gizlet.io
Range: bytes=0-3
HTTP 206
[Asserts]
header "content-range" matches /^bytes 0-3\/\d+$/
bytes count == 4

# The short link picks the newest compatible package.
GET {{base}}/github.com/fixture-org/hello-gizlet?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: dl.gizlet.io
HTTP 302
[Asserts]
header "Location" == "{{url}}"

GET {{base}}/github.com/fixture-org/hello-gizlet
x-gizlet-host: dl.gizlet.io
HTTP 302
[Asserts]
header "Location" == "{{site}}/github.com/fixture-org/hello-gizlet"

# Packages of failed releases are never served, not even from GitHub.
GET {{base}}/github.com/fixture-org/symlink/v0.1.0/dev.fixture.symlink-0.1.0-aarch64-unknown-linux-gnu-lite.gzl
x-gizlet-host: dl.gizlet.io
HTTP 410

# Older mirrored releases are still served; art comes from R2 too.
GET {{base}}/github.com/fixture-org/hello-gizlet/v0.2.0/icon.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "content-type" == "image/png"

GET {{base}}/github.com/fixture-org/unknown/v1.0.0/x.gzl
x-gizlet-host: dl.gizlet.io
HTTP 404

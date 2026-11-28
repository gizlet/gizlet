# The Launcher for macOS: its update manifest, version folders and download button.

GET {{base}}/assets/macos/latest.json
HTTP 200
[Captures]
etag: header "ETag"
[Asserts]
header "Cache-Control" == "no-cache"
header "Content-Type" contains "json"
jsonpath "$.schema" == 1
jsonpath "$.manifest" contains "\"tag\":\"v0.1.1\""

# Revalidating answers 304 while it is unchanged.
GET {{base}}/assets/macos/latest.json
If-None-Match: {{etag}}
HTTP 304

GET {{base}}/assets/macos/download
HTTP 302
[Asserts]
header "Location" endsWith "/install#macos"
header "Cache-Control" == "no-cache"

GET {{base}}/assets/macos/download/arm64
HTTP 302
[Asserts]
header "Location" endsWith "/assets/macos/releases/v0.1.1/Gizlet-0.1.1-arm64.dmg"
header "Cache-Control" == "no-cache"

GET {{base}}/assets/macos/download/x86_64
HTTP 302
[Asserts]
header "Location" endsWith "/assets/macos/releases/v0.1.1/Gizlet-0.1.1-x86_64.dmg"
header "Cache-Control" == "no-cache"

GET {{base}}/assets/macos/download/unknown
HTTP 404

GET {{base}}/assets/macos/releases/v0.1.1/Gizlet-0.1.1-arm64.dmg
HTTP 200
[Asserts]
header "Cache-Control" == "public, max-age=31536000, immutable"

GET {{base}}/assets/macos/releases/v0.1.1/Gizlet-0.1.1-x86_64.dmg
HTTP 200
[Asserts]
header "Cache-Control" == "public, max-age=31536000, immutable"

GET {{base}}/assets/macos/releases/v0.1.1/manifest.json
HTTP 200

# A version whose manifest is not uploaded yet is not served.
GET {{base}}/assets/macos/releases/v0.2.0/Gizlet-0.2.0.dmg
HTTP 404

GET {{base}}/assets/macos/releases/v0.1.0/..%2Fmanifest.json
HTTP 404

GET {{base}}/assets/macos/releases/latest/Gizlet-0.1.0.dmg
HTTP 404

GET {{base}}/install
HTTP 200
[Asserts]
xpath "string(//div[@id='macos']//a[1]/@href)" == "/assets/macos/download/arm64"
xpath "string(//div[@id='macos']//a[2]/@href)" == "/assets/macos/download/x86_64"
body contains "macOS 14"

# Gizlet Launcher for Windows: the update manifest, installers and the latest-installer link.

GET {{base}}/assets/windows/update.json
HTTP 200
[Captures]
etag: header "ETag"
[Asserts]
header "Cache-Control" == "no-cache"
jsonpath "$.manifest" contains "GizletSetup-0.1.0-x64.exe"
jsonpath "$.signature" startsWith "-----BEGIN SSH SIGNATURE-----"

# Every request revalidates; an unchanged manifest answers 304.
GET {{base}}/assets/windows/update.json
If-None-Match: {{etag}}
HTTP 304

GET {{base}}/assets/windows/releases/v0.1.0/GizletSetup-0.1.0-x64.exe
HTTP 200
[Asserts]
header "Cache-Control" contains "immutable"
body == "MZ fixture setup"

GET {{base}}/assets/windows/releases/v0.1.0/GizletSetup-0.1.0-x64.exe
Range: bytes=0-1
HTTP 206
[Asserts]
body == "MZ"

# Only installers whose name matches the tag, and nothing else under windows/.
GET {{base}}/assets/windows/releases/v0.2.0/GizletSetup-0.1.0-x64.exe
HTTP 404

GET {{base}}/assets/windows/releases/v0.1.0/update.json
HTTP 404

GET {{base}}/assets/windows/releases/v0.1.0/GizletSetup-0.1.0-x64.msi
HTTP 404

GET {{base}}/assets/windows/latest/x64
HTTP 302
[Asserts]
header "Location" endsWith "/assets/windows/releases/v0.1.0/GizletSetup-0.1.0-x64.exe"

GET {{base}}/assets/windows/latest/arm64
HTTP 404

GET {{base}}/assets/windows/latest/x86
HTTP 404

GET {{base}}/install
HTTP 200
[Asserts]
xpath "string(//div[contains(@class,'platform win')]//a/@href)" == "/assets/windows/latest/x64"

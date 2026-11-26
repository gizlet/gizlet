# Read-only checks against production after a deploy.
GET https://api.gizlet.io/v1/healthz
HTTP 200
[Asserts]
jsonpath "$.ok" == true

GET https://api.gizlet.io/v1
HTTP 200
[Asserts]
jsonpath "$.name" == "Gizlet API"

GET https://gizlet.io/
HTTP 200
[Asserts]
header "content-security-policy" exists

GET https://www.gizlet.io/github.com/gizlet/gizlet
HTTP 301
[Asserts]
header "Location" == "https://gizlet.io/github.com/gizlet/gizlet"

POST https://api.gizlet.io/v1/auth/device/code
{"client_id": "gizlet-os"}
HTTP 200
[Asserts]
jsonpath "$.verification_uri" == "https://gizlet.io/device"

GET https://api.gizlet.io/v1/me
HTTP 401

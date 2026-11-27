# Read-only checks against production after a deploy.
GET https://gizlet.io/api/v1/healthz
HTTP 200
[Asserts]
jsonpath "$.ok" == true

GET https://gizlet.io/api/v1
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

POST https://gizlet.io/api/v1/auth/device/code
{"client_id": "gizlet-os"}
HTTP 200
[Asserts]
jsonpath "$.verification_uri" == "https://gizlet.io/device"

GET https://gizlet.io/api/v1/me
HTTP 401

GET https://gizlet.io/api/v1/gizlets?sort=score&limit=1
HTTP 200
[Asserts]
jsonpath "$.gizlets" exists

# Kinds: every gizlet has one, and the list filters by it.
GET https://gizlet.io/api/v1/gizlets?kind=app&limit=100
HTTP 200
[Asserts]
jsonpath "$.gizlets[?(@.kind != 'app')]" not exists

GET https://gizlet.io/api/v1/gizlets?kind=service
HTTP 200
[Asserts]
jsonpath "$.gizlets" exists

GET https://gizlet.io/api/v1/gizlets?kind=rom
HTTP 400

GET https://gizlet.io/explore?kind=service&lang=en
HTTP 200
[Asserts]
xpath "string(//nav[@aria-label='Kind']/a[@aria-current='page'])" == "Services"

GET https://gizlet.io/api/v1/me/ratings
HTTP 401

# Curation: hand-picked featured lists and visibility overrides.
PUT {{base}}/v1/admin/collections/picks
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"title": "Picks", "titles": {"zh-CN": "精选"}, "repos": ["github.com/fixture-org/hello-gizlet", "fixture-org/on-demand"]}
HTTP 200
[Asserts]
jsonpath "$.repos" count == 2

# Featured lists show listed gizlets only: on-demand is unlisted.
GET {{base}}/v1/featured
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.sections[?(@.id == 'picks')].gizlets[*].repo" == "github.com/fixture-org/hello-gizlet"

# An admin can list it anyway.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "listed"
jsonpath "$.locked" == true

GET {{base}}/v1/gizlets?q=on-demand
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1

# Back to the checks' verdict.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "unlisted"
jsonpath "$.locked" == false

# Blocking stops everything, links included.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "blocked", "reason": "malware report"}
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand
x-gizlet-host: api.gizlet.io
HTTP 403
[Asserts]
jsonpath "$.error.code" == "blocked"
jsonpath "$.error.message" contains "malware report"

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand/install?target=x86_64-unknown-linux-gnu&tier=full
x-gizlet-host: api.gizlet.io
HTTP 403

GET {{base}}/github.com/fixture-org/on-demand/v1.0.0/dev.fixture.ondemand-1.0.0-x86_64-unknown-linux-gnu-full.gzl
x-gizlet-host: dl.gizlet.io
HTTP 403

GET {{base}}/github.com/fixture-org/on-demand
x-gizlet-host: gizlet.io
HTTP 403

GET {{fixture}}/token?repo=fixture-org/on-demand&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{token}}
{}
HTTP 403

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "gone"}
HTTP 400

DELETE {{base}}/v1/admin/collections/picks
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
HTTP 204

PUT {{base}}/v1/admin/collections/picks
x-gizlet-host: api.gizlet.io
Authorization: Bearer wrong
{"title": "x", "repos": []}
HTTP 401

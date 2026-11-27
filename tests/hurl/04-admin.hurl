# The featured variable names one listed, one unlisted and one missing gizlet.
GET {{base}}/api/v1/featured
HTTP 200
[Asserts]
jsonpath "$.hero[0].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.sections[0].id" == "picks"
jsonpath "$.sections[0].gizlets" count == 1
jsonpath "$.sections[0].gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/?lang=zh-CN
HTTP 200
[Asserts]
xpath "string(//a[@class='caption']/@href)" == "/github.com/fixture-org/hello-gizlet"
xpath "string(//section[@id='gizlets']//h2[1])" == "编辑精选"

# An admin can list it anyway.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "listed"
jsonpath "$.locked" == true

GET {{base}}/api/v1/gizlets?q=on-demand
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1

GET {{base}}/api/v1/featured
HTTP 200
[Asserts]
jsonpath "$.hero[0].repo" == "github.com/fixture-org/on-demand"
jsonpath "$.sections[0].id" == "picks"
jsonpath "$.sections[0].gizlets[0].repo" == "github.com/fixture-org/on-demand"
jsonpath "$.sections[0].gizlets[1].repo" == "github.com/fixture-org/hello-gizlet"

# Back to the checks' verdict.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "unlisted"
jsonpath "$.locked" == false

# Blocking stops everything, links included.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "blocked", "reason": "malware report"}
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/on-demand
HTTP 403
[Asserts]
jsonpath "$.error.code" == "blocked"
jsonpath "$.error.message" contains "malware report"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/on-demand/install?target=x86_64-unknown-linux-gnu&tier=full
HTTP 403

GET {{base}}/assets/github.com/fixture-org/on-demand/v1.0.0/dev.fixture.ondemand-1.0.0-x86_64-unknown-linux-gnu-full.gzl
HTTP 403

GET {{base}}/github.com/fixture-org/on-demand
HTTP 403

GET {{fixture}}/token?repo=fixture-org/on-demand&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
token: jsonpath "$.value"

POST {{base}}/api/v1/publish
Authorization: Bearer {{token}}
{}
HTTP 403

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "gone"}
HTTP 400

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/on-demand/visibility
Authorization: Bearer wrong
{"visibility": "listed"}
HTTP 401

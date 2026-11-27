# Basic API routes.
GET {{base}}/api/v1
HTTP 200
[Asserts]
jsonpath "$.name" == "Gizlet API"
jsonpath "$.source" == "https://github.com/gizlet/gizlet"

GET {{base}}/api/v1/healthz
HTTP 200
[Asserts]
jsonpath "$.ok" == true

GET {{base}}/api/v1/resolve?url=https://github.com/Fixture-Org/Hello-Gizlet.git
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.share_url" == "{{site}}/github.com/fixture-org/hello-gizlet"
jsonpath "$.api_url" == "{{site}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/healthz
HTTP 404

# Share links on any copy of the site, and API and download URLs, resolve too.
GET {{base}}/api/v1/resolve?url={{site}}/github.com/fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/api/v1/resolve?url=https://gizlet.io/assets/github.com/Fixture-Org/hello-gizlet/v0.2.0/x.gzl
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/api/v1/resolve?url=example.com/hello-gizlet
HTTP 400

GET {{base}}/api/v1/resolve?url=not%20a%20repo
HTTP 400
[Asserts]
jsonpath "$.error.code" == "bad_request"

GET {{base}}/api/v1/nope
HTTP 404
[Asserts]
jsonpath "$.error.code" == "not_found"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/no-index
HTTP 404
[Asserts]
jsonpath "$.error.message" contains "no release with a gizlet.toml"

POST {{base}}/api/v1/publish
HTTP 401
[Asserts]
jsonpath "$.error.code" == "unauthorized"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/visibility
HTTP 401

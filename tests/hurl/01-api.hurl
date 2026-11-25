# Basic API routes.
GET {{base}}/v1
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.name" == "Gizlet API"
jsonpath "$.source" == "https://github.com/gizlet/gizlet"

GET {{base}}/v1/healthz
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.ok" == true

GET {{base}}/v1/resolve?url=https://github.com/Fixture-Org/Hello-Gizlet.git
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.share_url" == "{{site}}/github.com/fixture-org/hello-gizlet"
jsonpath "$.api_url" == "https://api.gizlet.io/v1/gizlets/github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/resolve?url=store.gizlet.io/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/resolve?url=not%20a%20repo
x-gizlet-host: api.gizlet.io
HTTP 400
[Asserts]
jsonpath "$.error.code" == "bad_request"

GET {{base}}/v1/nope
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.code" == "not_found"

GET {{base}}/v1/gizlets/github.com/fixture-org/no-index
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.message" contains "no release with a gizlet.json"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
HTTP 401
[Asserts]
jsonpath "$.error.code" == "unauthorized"

POST {{base}}/v1/admin/collections/x
x-gizlet-host: api.gizlet.io
HTTP 401

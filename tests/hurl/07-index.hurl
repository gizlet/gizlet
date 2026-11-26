# Indexing through the GitHub App, private repositories, and refreshing on views.
# The suite runs with REFRESH_AFTER_SECONDS=3.

# hello-gizlet has the app installed: 02-publish read it through the API, and its packages
# came from short-lived signed URLs, which refuse our Authorization header.
GET {{fixture}}/_fixture/hits?key=api:fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.count" > 0

GET {{fixture}}/_fixture/hits?key=signed:fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.count" > 0

# --- A private repository with the app installed --------------------------------------------

# Not on the public web at all.
GET {{fixture}}/fixture-org/secret-gizlet/releases/latest
HTTP 404

# Opening its link indexes the latest release through the app.
GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.version" == "1.2.0"
jsonpath "$.private" == true
jsonpath "$.readme_url" == null

GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet/releases/v1.2.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.mirrored" == true

# Its CI can publish: the token says private, and the app can read it.
GET {{fixture}}/token?repo=fixture-org/secret-gizlet&ref=refs/tags/v1.0.0&visibility=private
HTTP 200
[Captures]
secret_token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{secret_token}}
{}
HTTP 202

GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{secret_token}}
{"tag": "v1.1.0"}
HTTP 202

GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet/releases/v1.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

# Installs and downloads work like a public gizlet's, from R2.
GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet/install?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
secret_url: jsonpath "$.package.url" replace "https://dl.gizlet.io" "{{base}}"
[Asserts]
jsonpath "$.version" == "1.2.0"

GET {{secret_url}}
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "x-checksum-sha256" exists

# Only the newest two stay in R2. A pruned private release has no public GitHub URL, so the
# download redirects to a fresh signed one, never cached.
GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.mirrored" == false

GET {{base}}/github.com/fixture-org/secret-gizlet/v1.0.0/dev.fixture.secretgizlet-1.0.0-aarch64-unknown-linux-gnu-lite.gzl
x-gizlet-host: dl.gizlet.io
HTTP 302
[Captures]
signed_url: header "location"
[Asserts]
header "location" startsWith "{{fixture}}/_signed/"
header "cache-control" == "no-store"

GET {{signed_url}}
HTTP 200

# --- A private repository without the app ---------------------------------------------------

GET {{base}}/v1/gizlets/github.com/fixture-org/hidden
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.code" == "not_found"

GET {{fixture}}/token?repo=fixture-org/hidden&ref=refs/tags/v1.0.0&visibility=private
HTTP 200
[Captures]
hidden_token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{hidden_token}}
{}
HTTP 403
[Asserts]
jsonpath "$.error.code" == "app_not_installed"
jsonpath "$.error.install_url" == "https://github.com/apps/gizlet-bot/installations/new"

# --- Refreshing on views ----------------------------------------------------------------------

# First sight indexes the latest release (a public repository without the app: the web).
GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.version" == "1.0.0"

GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

# The developer releases 1.1.0 without publishing it to Gizlet.
POST {{fixture}}/_fixture/release?repo=fixture-org/refresh-me&version=1.1.0
HTTP 201

GET {{fixture}}/_fixture/hits?key=latest:fixture-org/refresh-me
HTTP 200
[Captures]
hits_before: jsonpath "$.count"

# Once the interval has passed, a burst of views on every host refreshes it once.
GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500ms
HTTP 200
[Asserts]
jsonpath "$.version" == "1.0.0"

GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/github.com/fixture-org/refresh-me
x-gizlet-host: gizlet.io
HTTP 200

GET {{base}}/github.com/fixture-org/refresh-me?target=aarch64-unknown-linux-gnu&tier=lite
x-gizlet-host: dl.gizlet.io
HTTP 302

GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me/releases
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{fixture}}/_fixture/hits?key=latest:fixture-org/refresh-me&since={{hits_before}}
[Options]
delay: 500ms
HTTP 200
[Asserts]
jsonpath "$.since" == 1

# Within the interval, views are answered from the registry and ask GitHub nothing.
GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{fixture}}/_fixture/hits?key=latest:fixture-org/refresh-me&since={{hits_before}}
[Options]
delay: 200ms
HTTP 200
[Asserts]
jsonpath "$.since" == 1

# The new release was found, mirrored and checked, and the gizlet moved to it.
GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me/releases/v1.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/v1/gizlets/github.com/fixture-org/refresh-me
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.version" == "1.1.0"

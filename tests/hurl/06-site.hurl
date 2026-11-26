# gizlet.io pages.
GET {{base}}/
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-security-policy" contains "script-src 'self'"
xpath "string(//h1)" contains "One link."
body contains "href=\"/github.com/fixture-org/hello-gizlet\""
body not contains "fixture-org/on-demand"
body contains "/v1/publish"

# The home page's link box opens any way of writing a repository.
GET {{base}}/open?url=https%3A%2F%2Fgithub.com%2FFixture-Org%2Fhello-gizlet%2Freleases
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

GET {{base}}/open?url=%3Cb%3Enope
x-gizlet-host: gizlet.io
HTTP 400
[Asserts]
body contains "&lt;b&gt;nope"
body not contains "<b>nope"

GET {{base}}/github.com/fixture-org/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "Hello Gizlet"
body contains "aarch64-unknown-linux-gnu"

GET {{base}}/github.com/fixture-org/no-index
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/login
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body contains "/static/login.js"

GET {{base}}/device?user_code=ABCD%3Cscript%3E
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body not contains "ABCD<script>"
body contains "ABCD&lt;script&gt;"

GET {{base}}/static/device.js
HTTP 200
[Asserts]
body contains "/device/"

# www redirects to gizlet.io, keeping the path and query.
GET {{base}}/github.com/fixture-org/hello-gizlet?x=1
x-gizlet-host: www.gizlet.io
HTTP 301
[Asserts]
header "Location" == "{{site}}/github.com/fixture-org/hello-gizlet?x=1"

GET {{base}}/
x-gizlet-host: www.gizlet.io
HTTP 301

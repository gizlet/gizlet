# Accounts: email + password, bearer tokens, and the device flow a console uses.
# Cookies are set for the site's domain, never 127.0.0.1, so only the bearer tokens authenticate.
POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "correct horse battery", "name": "Player"}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"
header "set-auth-token" exists

POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "correct horse battery", "name": "Again"}
HTTP 422

POST {{base}}/v1/auth/sign-in/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "wrong password!"}
HTTP 401

POST {{base}}/v1/auth/sign-in/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "correct horse battery"}
HTTP 200
[Captures]
web_token: header "set-auth-token"

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"
jsonpath "$.user.github_login" == null
jsonpath "$.sign_in_methods" contains "email"
header "cache-control" == "no-store"

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
HTTP 401

GET {{base}}/v1/me/gizlets
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.github_login" == null
jsonpath "$.gizlets" count == 0

# The console asks for a code.
POST {{base}}/v1/auth/device/code
x-gizlet-host: api.gizlet.io
{"client_id": "gizlet-os"}
HTTP 200
[Captures]
device_code: jsonpath "$.device_code"
user_code: jsonpath "$.user_code"
[Asserts]
jsonpath "$.verification_uri" == "{{site}}/device"
jsonpath "$.interval" == 5

POST {{base}}/v1/auth/device/code
x-gizlet-host: api.gizlet.io
{"client_id": "somebody-else"}
HTTP 400

# Until the user approves, the console keeps polling.
POST {{base}}/v1/auth/device/token
x-gizlet-host: api.gizlet.io
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 400
[Asserts]
jsonpath "$.error" == "authorization_pending"

# The user opens gizlet.io/device signed in: opening the code claims it, then they allow it.
GET {{base}}/v1/auth/device?user_code={{user_code}}
x-gizlet-host: gizlet.io
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "pending"
jsonpath "$.client_id" == "gizlet-os"

POST {{base}}/v1/auth/device/approve
x-gizlet-host: gizlet.io
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"userCode": "{{user_code}}"}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# The poll interval is 5 s; wait it out before asking again.
POST {{base}}/v1/auth/device/token
x-gizlet-host: api.gizlet.io
[Options]
delay: 5500
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 200
[Captures]
device_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.token_type" == "Bearer"

# The console is now signed in to the same account.
GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{device_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"

# A device code works once.
POST {{base}}/v1/auth/device/token
x-gizlet-host: api.gizlet.io
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 400

# Signing out on the console ends only its session.
POST {{base}}/v1/auth/sign-out
x-gizlet-host: api.gizlet.io
Origin: {{site}}
Authorization: Bearer {{device_token}}
{}
HTTP 200

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{device_token}}
HTTP 401

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{web_token}}
HTTP 200

# The site's account pages may call the API with cookies; other origins may not.
OPTIONS {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Origin: {{site}}
Access-Control-Request-Method: GET
HTTP 204
[Asserts]
header "access-control-allow-origin" == "{{site}}"
header "access-control-allow-credentials" == "true"

OPTIONS {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Origin: https://evil.example
Access-Control-Request-Method: GET
HTTP 204
[Asserts]
header "access-control-allow-origin" not exists

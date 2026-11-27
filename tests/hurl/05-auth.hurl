# Accounts: email + password, bearer tokens, and the device flow a console uses.
# Cookies are set for the site's domain, never 127.0.0.1, so only the bearer tokens authenticate.
POST {{base}}/api/v1/auth/sign-up/email
Origin: {{site}}
{"email": "Player-{{run}}@example.com", "password": "correct horse battery", "name": "Player", "callbackURL": "/login?verified=1&next=%2Faccount"}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"
jsonpath "$.user.emailVerified" == false
jsonpath "$.token" == null
header "set-auth-token" not exists

# Until the address is confirmed there is no session; each try mails a fresh link. This one
# comes in through a mirror on a listed domain (SITE_DOMAINS), so its link is on that domain.
POST {{base}}/api/v1/auth/sign-in/email
X-Forwarded-Host: api.mirror.test
Origin: {{site}}
Accept-Language: zh-CN
{"email": "player-{{run}}@example.com", "password": "correct horse battery", "callbackURL": "/login?verified=1&next=%2Faccount"}
HTTP 403
[Asserts]
jsonpath "$.code" == "EMAIL_NOT_VERIFIED"
header "set-auth-token" not exists

# The newest link, in the language of the request that sent it.
GET {{base}}/api/v1/dev/mail?to=player-{{run}}@example.com
HTTP 200
[Captures]
verify_token: jsonpath "$.link" regex "token=([^&]+)"
[Asserts]
jsonpath "$.subject" == "确认你的 Gizlet 邮箱"
jsonpath "$.link" startsWith "https://mirror.test/api/v1/auth/verify-email?token="
jsonpath "$.link" contains "callbackURL=%2Flogin%3Fverified%3D1%26next%3D%252Faccount"

# A forged or broken link changes nothing and says why.
GET {{base}}/api/v1/auth/verify-email?token=not-a-token&callbackURL=%2Flogin%3Fverified%3D1
HTTP 302
[Asserts]
header "location" == "/login?verified=1&error=INVALID_TOKEN"
header "set-auth-token" not exists

# Opening the link confirms the address and signs the user in.
GET {{base}}/api/v1/auth/verify-email?token={{verify_token}}&callbackURL=%2Flogin%3Fverified%3D1%26next%3D%252Faccount
HTTP 302
[Captures]
verified_token: header "set-auth-token"
[Asserts]
header "location" == "/login?verified=1&next=%2Faccount"

GET {{base}}/api/v1/me
Authorization: Bearer {{verified_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email_verified" == true

# Signing up again with the address answers like a new sign-up and mails the owner instead.
# An unlisted domain gets links to the site.
POST {{base}}/api/v1/auth/sign-up/email
X-Forwarded-Host: evil.example
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "another password!", "name": "Again"}
HTTP 200
[Asserts]
jsonpath "$.token" == null
header "set-auth-token" not exists

GET {{base}}/api/v1/dev/mail?to=player-{{run}}@example.com
HTTP 200
[Asserts]
jsonpath "$.link" == "{{site}}/login"

POST {{base}}/api/v1/auth/sign-in/email
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "another password!"}
HTTP 401

POST {{base}}/api/v1/auth/sign-in/email
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "correct horse battery"}
HTTP 200
[Captures]
web_token: header "set-auth-token"

GET {{base}}/api/v1/me
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"
jsonpath "$.user.github_login" == null
jsonpath "$.sign_in_methods" contains "email"
header "cache-control" == "no-store"

GET {{base}}/api/v1/me
HTTP 401

GET {{base}}/api/v1/me/gizlets
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.github_login" == null
jsonpath "$.gizlets" count == 0

# The console asks for a code.
POST {{base}}/api/v1/auth/device/code
{"client_id": "gizlet-os"}
HTTP 200
[Captures]
device_code: jsonpath "$.device_code"
user_code: jsonpath "$.user_code"
[Asserts]
jsonpath "$.verification_uri" == "{{site}}/device"
jsonpath "$.interval" == 5

POST {{base}}/api/v1/auth/device/code
{"client_id": "somebody-else"}
HTTP 400

# Until the user approves, the console keeps polling.
POST {{base}}/api/v1/auth/device/token
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 400
[Asserts]
jsonpath "$.error" == "authorization_pending"

# The user opens gizlet.io/device signed in: opening the code claims it, then they allow it.
GET {{base}}/api/v1/auth/device?user_code={{user_code}}
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "pending"
jsonpath "$.client_id" == "gizlet-os"

POST {{base}}/api/v1/auth/device/approve
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"userCode": "{{user_code}}"}
HTTP 200
[Asserts]
jsonpath "$.success" == true

# The poll interval is 5 s; wait it out before asking again.
POST {{base}}/api/v1/auth/device/token
[Options]
delay: 5500
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 200
[Captures]
device_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.token_type" == "Bearer"

# The console is now signed in to the same account.
GET {{base}}/api/v1/me
Authorization: Bearer {{device_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"

# The account lists it among its devices; browser sessions are not devices.
GET {{base}}/api/v1/me/devices
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
header "cache-control" == "no-store"
jsonpath "$.devices" count == 1
jsonpath "$.devices[0].client_id" == "gizlet-os"
jsonpath "$.devices[0].signed_in_at" isString

# A device code works once.
POST {{base}}/api/v1/auth/device/token
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code}}", "client_id": "gizlet-os"}
HTTP 400

# Signing out on the console ends only its session.
POST {{base}}/api/v1/auth/sign-out
Origin: {{site}}
Authorization: Bearer {{device_token}}
{}
HTTP 200

GET {{base}}/api/v1/me
Authorization: Bearer {{device_token}}
HTTP 401

GET {{base}}/api/v1/me
Authorization: Bearer {{web_token}}
HTTP 200

GET {{base}}/api/v1/me/devices
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.devices" count == 0

# A second console, signed out from the account page instead.
POST {{base}}/api/v1/auth/device/code
{"client_id": "gizlet-cli"}
HTTP 200
[Captures]
device_code_2: jsonpath "$.device_code"
user_code_2: jsonpath "$.user_code"

GET {{base}}/api/v1/auth/device?user_code={{user_code_2}}
Authorization: Bearer {{web_token}}
HTTP 200

POST {{base}}/api/v1/auth/device/approve
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"userCode": "{{user_code_2}}"}
HTTP 200

POST {{base}}/api/v1/auth/device/token
[Options]
delay: 5500
{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "{{device_code_2}}", "client_id": "gizlet-cli"}
HTTP 200
[Captures]
device_token_2: jsonpath "$.access_token"

GET {{base}}/api/v1/me/devices
Authorization: Bearer {{web_token}}
HTTP 200
[Captures]
device_session_2: jsonpath "$.devices[0].id"
[Asserts]
jsonpath "$.devices" count == 1
jsonpath "$.devices[0].client_id" == "gizlet-cli"

# Nobody else can sign it out, and the account cannot sign out what is not one of its devices.
DELETE {{base}}/api/v1/me/devices/{{device_session_2}}
HTTP 401

DELETE {{base}}/api/v1/me/devices/not-a-session
Authorization: Bearer {{web_token}}
HTTP 404

DELETE {{base}}/api/v1/me/devices/{{device_session_2}}
Authorization: Bearer {{web_token}}
HTTP 204

GET {{base}}/api/v1/me
Authorization: Bearer {{device_token_2}}
HTTP 401

# The site's account pages may call the API with cookies; other origins may not.
OPTIONS {{base}}/api/v1/me
Origin: {{site}}
Access-Control-Request-Method: GET
HTTP 204
[Asserts]
header "access-control-allow-origin" == "{{site}}"
header "access-control-allow-credentials" == "true"

OPTIONS {{base}}/api/v1/me
Origin: https://evil.example
Access-Control-Request-Method: GET
HTTP 204
[Asserts]
header "access-control-allow-origin" not exists

# Profile: the name changes; the fields only Gizlet and admins set do not.
POST {{base}}/api/v1/auth/update-user
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"name": "Player Two"}
HTTP 200

POST {{base}}/api/v1/auth/update-user
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"linkMinLength": 3, "githubLogin": "someone"}
HTTP 400

GET {{base}}/api/v1/me
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.user.name" == "Player Two"
jsonpath "$.user.link_min_length" == 6
jsonpath "$.user.github_login" == null

# Password: the current one is needed.
POST {{base}}/api/v1/auth/change-password
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"currentPassword": "not my password", "newPassword": "a better password"}
HTTP 400
[Asserts]
jsonpath "$.code" == "INVALID_PASSWORD"

POST {{base}}/api/v1/auth/change-password
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"currentPassword": "correct horse battery", "newPassword": "a better password"}
HTTP 200

POST {{base}}/api/v1/auth/sign-in/email
Origin: {{site}}
{"email": "player-{{run}}@example.com", "password": "a better password"}
HTTP 200

# Email: a link goes to the new address, and the email changes once it is opened.
POST {{base}}/api/v1/auth/change-email
Origin: {{site}}
Authorization: Bearer {{web_token}}
{"newEmail": "Moved-{{run}}@example.com", "callbackURL": "/account?email=changed#profile"}
HTTP 200

GET {{base}}/api/v1/dev/mail?to=moved-{{run}}@example.com
HTTP 200
[Captures]
change_token: jsonpath "$.link" regex "token=([^&]+)"
[Asserts]
jsonpath "$.subject" == "Confirm your new email for Gizlet"

GET {{base}}/api/v1/me
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "player-{{run}}@example.com"

GET {{base}}/api/v1/auth/verify-email?token={{change_token}}&callbackURL=%2Faccount%3Femail%3Dchanged%23profile
HTTP 302
[Asserts]
header "location" == "/account?email=changed#profile"

GET {{base}}/api/v1/me
Authorization: Bearer {{web_token}}
HTTP 200
[Asserts]
jsonpath "$.user.email" == "moved-{{run}}@example.com"
jsonpath "$.user.email_verified" == true

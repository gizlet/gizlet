# Wants: handhelds people ask Gizlet OS to support, one want per account and handheld.

GET {{base}}/v1/handhelds
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.handhelds" count > 10
jsonpath "$.handhelds[?(@.id == 'r36s')].status" == "supported"
jsonpath "$.handhelds[?(@.id == 'r35s')].status" == "wanted"
jsonpath "$.handhelds[?(@.id == 'r35s')].wants" == 0

GET {{base}}/v1/handhelds?status=supported
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.handhelds" count == 1
jsonpath "$.handhelds[0].id" == "r36s"

GET {{base}}/v1/handhelds?status=soon
x-gizlet-host: api.gizlet.io
HTTP 400

# Signed out: nothing to read or change.
GET {{base}}/v1/me/wants
x-gizlet-host: api.gizlet.io
HTTP 401

PUT {{base}}/v1/me/wants/r35s
x-gizlet-host: api.gizlet.io
HTTP 401

# Better Auth allows 3 sign-ups from one address within 10 s of the last one. 08-marks has just
# made two and the device simulation makes one after this file, so let the window lapse first.
POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
[Options]
delay: 10000
{"email": "wanter-{{run}}@example.com", "password": "correct horse battery", "name": "Wanter", "callbackURL": "/account"}
HTTP 200

GET {{base}}/v1/dev/mail?to=wanter-{{run}}@example.com
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
wanter_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/v1/auth/verify-email?token={{wanter_verify}}&callbackURL=%2Faccount
x-gizlet-host: gizlet.io
HTTP 302
[Captures]
wanter: header "set-auth-token"

GET {{base}}/v1/me/wants
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
header "Cache-Control" == "no-store"
jsonpath "$.wants" count == 0

PUT {{base}}/v1/me/wants/r35s
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.handheld" == "r35s"
jsonpath "$.wanted" == true
jsonpath "$.wants" == 1

# Wanting it again changes nothing.
PUT {{base}}/v1/me/wants/r35s
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 1

# The site's own pages call it on gizlet.io.
PUT {{base}}/v1/me/wants/k36
x-gizlet-host: gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.handheld" == "k36"
jsonpath "$.wants" == 1

PUT {{base}}/v1/me/wants/r36s
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 409
[Asserts]
jsonpath "$.error.code" == "supported"
jsonpath "$.error.message" contains "/install/r36s"

PUT {{base}}/v1/me/wants/gameboy
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 404

GET {{base}}/v1/me/wants
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" count == 2
jsonpath "$.wants[*].id" contains "r35s"
jsonpath "$.wants[*].id" contains "k36"
jsonpath "$.wants[?(@.id == 'r35s')].name" == "R35S"
jsonpath "$.wants[?(@.id == 'r35s')].wants" == 1
jsonpath "$.wants[0].wanted_at" isIsoDate

GET {{base}}/v1/handhelds
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.handhelds[?(@.id == 'r35s')].wants" == 1

# The table shows how many want each handheld, and has the sign-in dialog for signed-out visitors.
GET {{base}}/install?lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//button[@data-device='r35s']/preceding-sibling::span[@class='want-n'])" == "1 person wants it"
xpath "string(//button[@data-device='rg351p']/preceding-sibling::span[@class='want-n'])" == ""
xpath "string(//button[@data-device='r35s']/@data-name)" == "R35S"
xpath "count(//dialog[@id='want-signin']//a[starts-with(@href, '/login?next=')])" == 1

GET {{base}}/install?lang=zh-CN
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//button[@data-device='k36']/preceding-sibling::span[@class='want-n'])" == "1 人想要"

GET {{base}}/account?lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "count(//ul[@id='wants'])" == 1
xpath "string(//h2)" == "Handhelds you want"

DELETE {{base}}/v1/me/wants/r35s
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wanted" == false
jsonpath "$.wants" == 0

DELETE {{base}}/v1/me/wants/r35s
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 0

DELETE {{base}}/v1/me/wants/gameboy
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 404

GET {{base}}/v1/me/wants
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" count == 1
jsonpath "$.wants[0].id" == "k36"

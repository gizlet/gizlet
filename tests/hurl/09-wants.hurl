# Wants: handhelds people ask Gizlet OS to support, one want per account and handheld.

GET {{base}}/api/v1/handhelds
HTTP 200
[Asserts]
jsonpath "$.handhelds" count > 10
jsonpath "$.handhelds[?(@.id == 'r36s')].status" == "released"
jsonpath "$.handhelds[?(@.id == 'r35s')].status" == "voting"
jsonpath "$.handhelds[?(@.id == 'r35s')].wants" == 0

GET {{base}}/api/v1/handhelds?status=supported
HTTP 200
[Asserts]
jsonpath "$.handhelds" count == 1
jsonpath "$.handhelds[0].id" == "r36s"
jsonpath "$.handhelds[0].can_vote" == false
jsonpath "$.handhelds[0].download_url" endsWith "gizlet-os-r36s.img.gz"

GET {{base}}/api/v1/handhelds?status=soon
HTTP 400

# Signed out: nothing to read or change.
GET {{base}}/api/v1/me/wants
HTTP 401

PUT {{base}}/api/v1/me/wants/r35s
HTTP 401

# Better Auth allows 3 sign-ups from one address within 10 s of the last one. 08-marks has just
# made two and the device simulation makes one after this file, so let the window lapse first.
POST {{base}}/api/v1/auth/sign-up/email
Origin: {{site}}
[Options]
delay: 10000
{"email": "wanter-{{run}}@example.com", "password": "correct horse battery", "name": "Wanter", "callbackURL": "/account"}
HTTP 200

GET {{base}}/api/v1/dev/mail?to=wanter-{{run}}@example.com
HTTP 200
[Captures]
wanter_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/api/v1/auth/verify-email?token={{wanter_verify}}&callbackURL=%2Faccount
HTTP 302
[Captures]
wanter: header "set-auth-token"

GET {{base}}/api/v1/me/wants
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
header "Cache-Control" == "no-store"
jsonpath "$.wants" count == 0

PUT {{base}}/api/v1/me/wants/r35s
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.handheld" == "r35s"
jsonpath "$.wanted" == true
jsonpath "$.wants" == 1

# Wanting it again changes nothing.
PUT {{base}}/api/v1/me/wants/r35s
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 1

# The site's own pages call it on gizlet.io.
PUT {{base}}/api/v1/me/wants/k36
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.handheld" == "k36"
jsonpath "$.wants" == 1

PUT {{base}}/api/v1/me/wants/r36s
Authorization: Bearer {{wanter}}
HTTP 409
[Asserts]
jsonpath "$.error.code" == "supported"
jsonpath "$.error.message" contains "/install/r36s"

PUT {{base}}/api/v1/me/wants/gameboy
Authorization: Bearer {{wanter}}
HTTP 404

GET {{base}}/api/v1/me/wants
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" count == 2
jsonpath "$.wants[*].id" contains "r35s"
jsonpath "$.wants[*].id" contains "k36"
jsonpath "$.wants[?(@.id == 'r35s')].name" == "R35S"
jsonpath "$.wants[?(@.id == 'r35s')].wants" == 1
jsonpath "$.wants[0].wanted_at" isIsoDate

GET {{base}}/api/v1/handhelds
HTTP 200
[Asserts]
jsonpath "$.handhelds[?(@.id == 'r35s')].wants" == 1

# The table shows how many want each handheld, and has the sign-in dialog for signed-out visitors.
GET {{base}}/install?status=all&lang=en
HTTP 200
[Asserts]
xpath "string(//button[@data-device='r35s']/span[@class='want-n'])" == "1"
xpath "string(//button[@data-device='r35s']/@aria-label)" contains "1 person wants it"
xpath "string(//button[@data-device='rg351p']/span[@class='want-n'])" == "0"
xpath "string(//button[@data-device='r35s']/@data-name)" == "R35S"
xpath "count(//dialog[@id='want-signin']//a[starts-with(@href, '/login?next=')])" == 1

GET {{base}}/install?status=all&lang=zh-CN
HTTP 200
[Asserts]
xpath "string(//button[@data-device='k36']/span[@class='want-n'])" == "1"

# The account page draws each as a card, newest first, with how many want it.
GET {{base}}/account?lang=en
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
xpath "string(//section[@id='panel-handhelds']//h2)" == "Handhelds you want"
xpath "count(//ul[@id='wants']/li)" == 2
xpath "string(//ul[@id='wants']/li[1]//h3)" == "K36"
xpath "count(//ul[@id='wants']//div[contains(@class, 'handheld')])" == 2
xpath "string(//ul[@id='wants']/li[2]//button[contains(@class, 'unwant')]/@data-handheld)" == "r35s"
xpath "string(//a[@id='tab-handhelds']/span[@class='n'])" == "2"

DELETE {{base}}/api/v1/me/wants/r35s
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wanted" == false
jsonpath "$.wants" == 0

DELETE {{base}}/api/v1/me/wants/r35s
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 0

DELETE {{base}}/api/v1/me/wants/gameboy
Authorization: Bearer {{wanter}}
HTTP 404

GET {{base}}/api/v1/me/wants
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" count == 1
jsonpath "$.wants[0].id" == "k36"

PUT {{base}}/api/v1/me/wants/batlexp-g350
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 1

PUT {{base}}/api/v1/me/wants/batlexp-g350
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 1

GET {{base}}/api/v1/handhelds?status=all
HTTP 200
[Asserts]
jsonpath "$.handhelds[0].id" == "k36"
jsonpath "$.handhelds[0].wants" == 1
jsonpath "$.total" == 14

GET {{base}}/api/v1/handhelds?status=catalog
HTTP 200
[Asserts]
jsonpath "$.total" == 596
jsonpath "$.pages" == 15
jsonpath "$.handhelds[0].id" == "batlexp-g350"
jsonpath "$.handhelds[0].wants" == 1
jsonpath "$.handhelds[*].id" not contains "k36"
jsonpath "$.handhelds[*].id" not contains "r36s"

GET {{base}}/install?status=catalog&lang=en
HTTP 200
[Asserts]
xpath "string((//li[@data-search])[1]//button/@data-device)" == "batlexp-g350"
xpath "count(//button[@data-device='k36'])" == 0
xpath "string(//button[@data-device='batlexp-g350']/span[@class='want-n'])" == "1"

GET {{base}}/api/v1/me/wants
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants[0].id" == "batlexp-g350"

DELETE {{base}}/api/v1/me/wants/batlexp-g350
Authorization: Bearer {{wanter}}
HTTP 200
[Asserts]
jsonpath "$.wants" == 0

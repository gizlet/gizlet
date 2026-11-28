GET {{base}}/install?status=development&lang=zh-CN
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 0
xpath "string(//p[@class='hh-empty'])" == "目前还没有正在开发的掌机适配。"

PUT {{base}}/api/v1/admin/handhelds/r35s/port
{"progress": "developing"}
HTTP 401

PUT {{base}}/api/v1/admin/handhelds/r36s/port
Authorization: Bearer {{admin_token}}
{"progress": "developing"}
HTTP 409

PUT {{base}}/api/v1/admin/handhelds/batlexp-g350/port
Authorization: Bearer {{admin_token}}
{"progress": "developing", "estimated_release_date": "2027-02-29"}
HTTP 400

PUT {{base}}/api/v1/admin/handhelds/batlexp-g350/port
Authorization: Bearer {{admin_token}}
{"progress": "developing", "estimated_release_date": "2026-12-18"}
HTTP 200
[Asserts]
jsonpath "$.estimated_release_date" == "2026-12-18"

PUT {{base}}/api/v1/admin/handhelds/batlexp-g350/port
Authorization: Bearer {{admin_token}}
{"progress": "developing"}
HTTP 200
[Asserts]
jsonpath "$.estimated_release_date" == "2026-12-18"

PUT {{base}}/api/v1/admin/handhelds/r35s/port
Authorization: Bearer {{admin_token}}
{"progress": "testing"}
HTTP 400

PUT {{base}}/api/v1/admin/handhelds/r35s/port
Authorization: Bearer {{admin_token}}
{"progress": "developing"}
HTTP 200

GET {{base}}/install?status=development&lang=en
HTTP 200
[Asserts]
xpath "count(//ul[@class='hh-list']/li[@class='is-developing'])" == 2
xpath "count(//li[@data-search]//button[@class='want'])" == 2
xpath "string(//button[@data-device='batlexp-g350']/span[@class='want-n'])" == "0"
xpath "string(//li[@data-search][contains(@data-search,'g350')]//time/@datetime)" == "2026-12-18"
body contains "Estimated release"

GET {{base}}/api/v1/handhelds?status=development&q=G350
HTTP 200
[Asserts]
jsonpath "$.total" == 1
jsonpath "$.handhelds[0].id" == "batlexp-g350"
jsonpath "$.handhelds[0].status" == "developing"
jsonpath "$.handhelds[0].progress" == "developing"
jsonpath "$.handhelds[0].estimated_release_date" == "2026-12-18"
jsonpath "$.handhelds[0].can_vote" == true

GET {{base}}/install?status=development&fragment=handhelds&lang=zh-CN
HTTP 200
[Asserts]
header "Cache-Control" == "no-store"
xpath "count(//div[@id='handheld-results']//button[@class='want'])" == 2
xpath "string(//time[@datetime='2026-12-18'])" == "2026-12-18"
body contains "预计上线"

PUT {{base}}/api/v1/admin/handhelds/batlexp-g350/port
Authorization: Bearer {{admin_token}}
{"progress": "developing", "estimated_release_date": null}
HTTP 200
[Asserts]
jsonpath "$.estimated_release_date" == null

GET {{base}}/api/v1/handhelds?status=catalog&q=G350
HTTP 200
[Asserts]
jsonpath "$.total" == 0

GET {{base}}/install?status=all&lang=en
HTTP 200
[Asserts]
xpath "count(//button[@data-device='r35s'])" == 0

PUT {{base}}/api/v1/admin/handhelds/r35s/port
Authorization: Bearer {{admin_token}}
{"progress": "voting"}
HTTP 200

PUT {{base}}/api/v1/admin/handhelds/batlexp-g350/port
Authorization: Bearer {{admin_token}}
{"progress": "unpicked"}
HTTP 200

GET {{base}}/install?status=development&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 0

GET {{base}}/api/v1/handhelds?status=catalog&q=G350
HTTP 200
[Asserts]
jsonpath "$.handhelds[0].id" == "batlexp-g350"

GET {{base}}/install/r36s?lang=zh-CN
HTTP 200
[Asserts]
xpath "string(//h1)" == "R36S"
body contains "/releases/v0.2.10/flash.sh | bash -s -- --board gameconsole.r36s"
body contains "/releases/v0.2.10/flash.ps1"
xpath "string(//details[@class='manual']//a[contains(@href, '.img.gz')]/@href)" == "https://gizlet.io/assets/releases/v0.2.10/boards/gameconsole/r36s/gizlet-os-r36s.img.gz"
xpath "string(//details[@class='manual']//a[contains(@href, 'SHA256SUMS')]/@href)" == "https://gizlet.io/assets/releases/v0.2.10/boards/gameconsole/r36s/SHA256SUMS"
body contains "烧录 Gizlet OS"
body not contains "/releases/v0.3.0/"

GET {{base}}/assets/releases/latest/manifest.json
HTTP 404

GET {{base}}/api/v1/os/releases/latest
HTTP 200
[Asserts]
jsonpath "$.tag" == "v0.2.10"
jsonpath "$.manifest_url" == "https://gizlet.io/assets/releases/v0.2.10/manifest.json"
jsonpath "$.signature_url" == "https://gizlet.io/assets/releases/v0.2.10/manifest.json.sig"

GET {{base}}/assets/releases/v0.2.10/manifest.json
HTTP 200
[Asserts]
jsonpath "$.tag" == "v0.2.10"

GET {{base}}/assets/releases/v0.3.0/flash.sh
HTTP 404

GET {{base}}/flash/r36s
HTTP 302
[Asserts]
header "Location" endsWith "/assets/releases/v0.2.10/flash.sh"

GET {{base}}/flash/r36s.ps1
HTTP 302
[Asserts]
header "Location" endsWith "/assets/releases/v0.2.10/flash.ps1"

GET {{base}}/flash/nope
HTTP 404

GET {{base}}/install/r36s?lang=zh-CN
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "R36S"
body contains "/releases/v0.2.10/flash.sh | bash -s -- --board gameconsole.r36s"
body contains "/releases/v0.2.10/flash.ps1"
xpath "string(//details[@class='manual']//a[contains(@href, '.img.gz')]/@href)" == "https://dl.gizlet.io/releases/v0.2.10/boards/gameconsole/r36s/gizlet-os-r36s.img.gz"
xpath "string(//details[@class='manual']//a[contains(@href, 'SHA256SUMS')]/@href)" == "https://dl.gizlet.io/releases/v0.2.10/boards/gameconsole/r36s/SHA256SUMS"
body contains "烧录 Gizlet OS"
body not contains "/releases/v0.3.0/"

GET {{base}}/releases/latest/manifest.json
x-gizlet-host: dl.gizlet.io
HTTP 302
[Asserts]
header "Location" == "https://dl.gizlet.io/releases/v0.2.10/manifest.json"

GET {{base}}/releases/v0.2.10/manifest.json
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.tag" == "v0.2.10"

GET {{base}}/releases/v0.3.0/flash.sh
x-gizlet-host: dl.gizlet.io
HTTP 404

GET {{base}}/flash/r36s
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "https://dl.gizlet.io/releases/latest/flash.sh"

GET {{base}}/flash/r36s.ps1
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "https://dl.gizlet.io/releases/latest/flash.ps1"

GET {{base}}/flash/nope
x-gizlet-host: gizlet.io
HTTP 404

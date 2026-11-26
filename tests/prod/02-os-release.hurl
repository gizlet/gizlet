GET https://dl.gizlet.io/releases/latest/manifest.json
HTTP 302
[Captures]
os_manifest: header "Location"
[Asserts]
header "Location" matches "^https://dl\\.gizlet\\.io/releases/v[0-9]+\\.[0-9]+\\.[0-9]+/manifest\\.json$"

GET {{os_manifest}}
HTTP 200
[Asserts]
jsonpath "$.schema_version" == 1
jsonpath "$.boards.gameconsole.r36s.image.path" exists

GET https://gizlet.io/install/r36s?lang=en
HTTP 200
[Captures]
os_version: regex "Gizlet OS release <b>(v[0-9]+\\.[0-9]+\\.[0-9]+)</b>"
[Asserts]
body contains "https://dl.gizlet.io/releases/{{os_version}}/flash.sh"
body contains "https://dl.gizlet.io/releases/{{os_version}}/flash.ps1"
xpath "string(//details[@class='manual']//a[contains(@href, '.img.gz')]/@href)" startsWith "https://dl.gizlet.io/releases/{{os_version}}/"
xpath "string(//details[@class='manual']//a[contains(@href, 'SHA256SUMS')]/@href)" startsWith "https://dl.gizlet.io/releases/{{os_version}}/"

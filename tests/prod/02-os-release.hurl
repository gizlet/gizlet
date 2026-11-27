GET https://gizlet.io/api/v1/os/releases/latest
HTTP 200
[Captures]
os_tag: jsonpath "$.tag"
os_manifest: jsonpath "$.manifest_url"
os_signature: jsonpath "$.signature_url"
[Asserts]
jsonpath "$.tag" matches "^v[0-9]+\\.[0-9]+\\.[0-9]+$"
jsonpath "$.manifest_url" == "https://gizlet.io/assets/releases/{{os_tag}}/manifest.json"
jsonpath "$.signature_url" == "https://gizlet.io/assets/releases/{{os_tag}}/manifest.json.sig"

GET {{os_manifest}}
HTTP 200
[Asserts]
jsonpath "$.schema_version" == 1
jsonpath "$.tag" == "{{os_tag}}"
jsonpath "$.boards.gameconsole.r36s.image.path" exists

GET {{os_signature}}
HTTP 200
[Asserts]
body contains "BEGIN SSH SIGNATURE"

GET {{os_manifest}}
[Options]
retry: 7
retry-interval: 500ms
HTTP 200
[Asserts]
header "X-Gizlet-Edge-Cache" == "HIT"

GET {{os_manifest}}
Range: bytes=0-15
HTTP 206
[Asserts]
header "Content-Range" matches "^bytes 0-15/[0-9]+$"
header "X-Gizlet-Edge-Cache" == "HIT"
bytes count == 16

GET https://gizlet.io/install/r36s?lang=en
HTTP 200
[Captures]
os_version: regex "Gizlet OS release <b>(v[0-9]+\\.[0-9]+\\.[0-9]+)</b>"
[Asserts]
body contains "https://gizlet.io/assets/releases/{{os_version}}/flash.sh"
body contains "https://gizlet.io/assets/releases/{{os_version}}/flash.ps1"
xpath "string(//details[@class='manual']//a[contains(@href, '.img.gz')]/@href)" startsWith "https://gizlet.io/assets/releases/{{os_version}}/"
xpath "string(//details[@class='manual']//a[contains(@href, 'SHA256SUMS')]/@href)" startsWith "https://gizlet.io/assets/releases/{{os_version}}/"

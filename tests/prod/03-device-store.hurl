# The launcher's Store: lists of what a handheld can install, its art as PNGs, and updates.
GET https://api.gizlet.io/v1/featured?kind=app&target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.kind != 'app')]" not exists

GET https://api.gizlet.io/v1/gizlets?kind=app&target=aarch64-unknown-linux-gnu&tier=lite&limit=1
HTTP 200
[Captures]
repo: jsonpath "$.gizlets[0].repo"
app_id: jsonpath "$.gizlets[0].id"
icon: jsonpath "$.gizlets[0].device_icon_url"
[Asserts]
jsonpath "$.gizlets[0].device_icon_url" contains "/~device/icon.png"

GET {{icon}}
HTTP 200
[Asserts]
header "content-type" == "image/png"
bytes startsWith hex,89504e470d0a1a0a0000000d494844520000008000000080;

POST https://api.gizlet.io/v1/updates
{"target": "aarch64-unknown-linux-gnu", "tier": "lite", "installed": [{"repo": "{{repo}}", "id": "{{app_id}}", "version": "0.0.0"}]}
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].status" == "update"
jsonpath "$.gizlets[0].package.sha256" exists

# The launcher's Store: lists of what a handheld can install, its art as PNGs, and updates.
GET https://api.gizlet.io/v1/featured?kind=app&target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200
[Asserts]
jsonpath "$.sections[*].gizlets[?(@.kind != 'app')]" not exists

# Releases from before repository ids are indexed again on refresh; listings wait for them.
GET https://api.gizlet.io/v1/gizlets?kind=app&target=aarch64-unknown-linux-gnu&tier=lite&limit=1
[Options]
retry: 60
retry-interval: 2s
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

# A gizlet read from the public web is indexed again under GitHub's repository id on its first install.
GET https://api.gizlet.io/v1/gizlets/{{repo}}/install?target=aarch64-unknown-linux-gnu&tier=lite
[Options]
retry: 60
retry-interval: 2s
HTTP 200
[Captures]
repository_id: jsonpath "$.repository_id"
[Asserts]
jsonpath "$.repository_id" isInteger

POST https://api.gizlet.io/v1/updates
{"target": "aarch64-unknown-linux-gnu", "tier": "lite", "installed": [{"repo": "{{repo}}", "repository_id": {{repository_id}}, "id": "{{app_id}}", "version": "0.0.0"}]}
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].status" == "update"
jsonpath "$.gizlets[0].package.sha256" exists

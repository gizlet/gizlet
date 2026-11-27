# Kinds and manifest schemas: apps (schema 1, schema 1 left out, schema 2) and schema 2 services,
# listed only once an editor approves them, and filtered by kind in the API and on Explore.

# A schema 2 service is indexed, mirrored and checked like an app.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/clock-service
HTTP 200
[Asserts]
jsonpath "$.kind" == "service"
jsonpath "$.category" == null

GET {{base}}/api/v1/gizlets/github.com/fixture-org/clock-service/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.warnings" count == 0
jsonpath "$.visibility" == "unlisted"
jsonpath "$.visibility_reason" == "awaiting editorial approval"

# Not listed before approval, though a device can install it by link.
GET {{base}}/api/v1/gizlets?kind=service
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/api/v1/gizlets/github.com/fixture-org/clock-service/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200
[Captures]
service_sha: jsonpath "$.package.sha256"
[Asserts]
jsonpath "$.kind" == "service"
jsonpath "$.package.file" == "dev.fixture.clockservice-1.0.0-aarch64-unknown-linux-gnu-lite.gzl"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/clock-service/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "listed"
jsonpath "$.locked" == true

GET {{base}}/api/v1/gizlets?kind=service
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/clock-service"
jsonpath "$.gizlets[0].kind" == "service"
jsonpath "$.gizlets[0].category" == null

# A schema 2 app, and an app whose manifest.json leaves out its schema (schema 1).
GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-app
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-app/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.visibility" == "unlisted"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/no-schema
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/no-schema/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-app
HTTP 200
[Asserts]
jsonpath "$.kind" == "app"
jsonpath "$.category" == "app"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/no-schema
HTTP 200
[Asserts]
jsonpath "$.kind" == "app"
jsonpath "$.category" == "game"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/v2-app/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/no-schema/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200

# An approved gizlet whose only release is published again keeps its approval, but leaves the
# lists until the new revision passes its checks: its downloads are held meanwhile.
POST {{fixture}}/_fixture/hold?repo=fixture-org/v2-app
HTTP 200

GET {{fixture}}/token?repo=fixture-org/v2-app&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
v2_token: jsonpath "$.value"

POST {{base}}/api/v1/publish
Authorization: Bearer {{v2_token}}
{}
HTTP 202

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-app/releases/v1.0.0
HTTP 200
[Asserts]
jsonpath "$.status" != "ready"
jsonpath "$.visibility" == "listed"

GET {{base}}/api/v1/gizlets?q=v2-app
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/explore?q=v2-app&lang=en
HTTP 200
[Asserts]
body not contains "href=\"/github.com/fixture-org/v2-app\""

GET {{base}}/api/v1/featured
HTTP 200
[Asserts]
jsonpath "$.hero[?(@.repo == 'github.com/fixture-org/v2-app')]" not exists
jsonpath "$.sections[*].gizlets[?(@.repo == 'github.com/fixture-org/v2-app')]" not exists

POST {{fixture}}/_fixture/release-hold?repo=fixture-org/v2-app
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-app/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.visibility" == "listed"

GET {{base}}/api/v1/gizlets?q=v2-app
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1

# Manifests that disagree with gizlet.toml, or that this release cannot read, fail their release.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/service-as-v1

GET {{base}}/api/v1/gizlets/github.com/fixture-org/service-as-v1/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "manifest.json is an app, gizlet.toml says kind \"service\""

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-no-kind

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v2-no-kind/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "schema 2 must name its kind"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v1-service-kind

GET {{base}}/api/v1/gizlets/github.com/fixture-org/v1-service-kind/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "schema 1 is always an app"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/schema-3

GET {{base}}/api/v1/gizlets/github.com/fixture-org/schema-3/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "only 1 and 2 are supported"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/schema-3/install?target=aarch64-unknown-linux-gnu
HTTP 404
[Asserts]
jsonpath "$.error.code" == "failed_checks"

# An install falls back to an older release of another kind; it reports that release's kind.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat
HTTP 200

GET {{fixture}}/token?repo=fixture-org/turncoat&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
turncoat_token: jsonpath "$.value"

POST {{base}}/api/v1/publish
Authorization: Bearer {{turncoat_token}}
{}
HTTP 202

GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat/releases/v2.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat
HTTP 200
[Asserts]
jsonpath "$.kind" == "app"
jsonpath "$.version" == "2.0.0"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200
[Asserts]
jsonpath "$.version" == "1.0.0"
jsonpath "$.kind" == "service"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/turncoat/install?target=x86_64-unknown-linux-gnu&tier=lite
HTTP 200
[Asserts]
jsonpath "$.version" == "2.0.0"
jsonpath "$.kind" == "app"

# Filtering by kind, alone and with search and category; a category is an app's.
GET {{base}}/api/v1/gizlets?kind=app&limit=100
HTTP 200
[Asserts]
jsonpath "$.gizlets[?(@.kind == 'service')]" not exists
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/v2-app')]" exists
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/no-schema')]" exists

GET {{base}}/api/v1/gizlets?kind=app&q=v2-app
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/v2-app"

GET {{base}}/api/v1/gizlets?kind=service&q=v2-app
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/api/v1/gizlets?category=app&limit=100
HTTP 200
[Asserts]
jsonpath "$.gizlets[?(@.kind == 'service')]" not exists
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/v2-app')]" exists

GET {{base}}/api/v1/gizlets?kind=app&limit=1
HTTP 200
[Captures]
next: jsonpath "$.next_cursor"
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.next_cursor" == "1"

GET {{base}}/api/v1/gizlets?kind=app&limit=1&cursor={{next}}
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].kind" == "app"

GET {{base}}/api/v1/gizlets?kind=rom
HTTP 400
[Asserts]
jsonpath "$.error.message" == "kind must be app or service"

GET {{base}}/api/v1/gizlets?kind=service&category=game
HTTP 400

GET {{base}}/api/v1/featured
HTTP 200
[Asserts]
jsonpath "$.sections[?(@.id == 'services')].gizlets[0].repo" == "github.com/fixture-org/clock-service"
jsonpath "$.sections[?(@.id == 'apps')].gizlets[?(@.kind == 'service')]" not exists
jsonpath "$.sections[?(@.id == 'games')].gizlets[?(@.kind == 'service')]" not exists

# Explore: kind tabs, a category row for apps, search and pages (EXPLORE_PAGE_SIZE is 2 here).
GET {{base}}/explore?kind=service&lang=en
HTTP 200
[Asserts]
xpath "string(//nav[@aria-label='Kind']/a[@aria-current='page'])" == "Services"
xpath "count(//nav[@aria-label='Category'])" == 0
xpath "count(//a[contains(@class, 'cart')])" == 1
body contains "href=\"/github.com/fixture-org/clock-service\""
xpath "string(//a[@href='/github.com/fixture-org/clock-service']//span[@class='meta']/span[1])" == "Service"
xpath "string(//form[@role='search']//input[@name='kind']/@value)" == "service"

GET {{base}}/explore?kind=service&q=clock&lang=en
HTTP 200
[Asserts]
body contains "href=\"/github.com/fixture-org/clock-service\""

GET {{base}}/explore?kind=service&q=snail&lang=en
HTTP 200
[Asserts]
xpath "count(//a[contains(@class, 'cart')])" == 0
body contains "No gizlets match."

GET {{base}}/explore?kind=app&lang=en
HTTP 200
[Captures]
more: xpath "string(//p[@class='more']/a/@href)"
[Asserts]
xpath "string(//nav[@aria-label='Kind']/a[@aria-current='page'])" == "Apps"
xpath "string(//nav[@aria-label='Category']/a[@aria-current='page'])" == "All apps"
xpath "count(//a[contains(@class, 'cart')])" == 2
body not contains "href=\"/github.com/fixture-org/clock-service\""
xpath "string(//p[@class='more']/a/@href)" == "/explore?kind=app&cursor=2"

GET {{base}}{{more}}&lang=en
HTTP 200
[Asserts]
xpath "string(//nav[@aria-label='Kind']/a[@aria-current='page'])" == "Apps"
xpath "count(//a[contains(@class, 'cart')])" == 2
body not contains "href=\"/github.com/fixture-org/clock-service\""

# Search keeps the kind, and its pages keep both.
GET {{base}}/explore?kind=app&q=fixture&lang=en
HTTP 200
[Asserts]
xpath "string(//form[@role='search']//input[@name='kind']/@value)" == "app"
xpath "string(//p[@class='more']/a/@href)" == "/explore?q=fixture&kind=app&cursor=2"

# Categories filter apps; a link with only a category, as before kinds, means apps.
GET {{base}}/explore?category=game&lang=en
HTTP 200
[Asserts]
xpath "string(//nav[@aria-label='Kind']/a[@aria-current='page'])" == "Apps"
xpath "string(//nav[@aria-label='Category']/a[@aria-current='page'])" == "Games"
body not contains "href=\"/github.com/fixture-org/v2-app\""

GET {{base}}/explore?kind=app&category=app&lang=en
HTTP 200
[Asserts]
xpath "string(//nav[@aria-label='Category']/a[@aria-current='page'])" == "Apps & tools"
body contains "href=\"/github.com/fixture-org/v2-app\""
body not contains "href=\"/github.com/fixture-org/clock-service\""

# A service has no category: one in the link is ignored.
GET {{base}}/explore?kind=service&category=game&lang=en
HTTP 200
[Asserts]
body contains "href=\"/github.com/fixture-org/clock-service\""

GET {{base}}/github.com/fixture-org/clock-service?lang=en
HTTP 200
[Asserts]
xpath "string(//p[@class='kicker'])" startsWith "Service"

# Blocking an approved gizlet takes it out of every list and off the download host.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/clock-service/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "blocked", "reason": "test block"}
HTTP 200

GET {{base}}/api/v1/gizlets?kind=service
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

GET {{base}}/explore?kind=service&lang=en
HTTP 200
[Asserts]
body not contains "href=\"/github.com/fixture-org/clock-service\""

GET {{base}}/api/v1/gizlets/github.com/fixture-org/clock-service/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 403

GET {{base}}/assets/github.com/fixture-org/clock-service/v1.0.0/dev.fixture.clockservice-1.0.0-aarch64-unknown-linux-gnu-lite.gzl?sha256={{service_sha}}
HTTP 403

# Handing it back to the checks does not list it again: that takes a new approval.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/clock-service/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "unlisted"
jsonpath "$.visibility_reason" == "awaiting editorial approval"
jsonpath "$.locked" == false

GET {{base}}/api/v1/gizlets?kind=service
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 0

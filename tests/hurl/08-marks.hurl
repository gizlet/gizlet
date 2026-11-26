# Marks (awesome, scanned), malware scans, ratings and the score.

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
score_plain: jsonpath "$.score"
[Asserts]
jsonpath "$.marks" count == 0
jsonpath "$.rating.count" == 0
jsonpath "$.rating.average" == null
jsonpath "$.score" isInteger
jsonpath "$.private" == false

# --- awesome: set by an admin -----------------------------------------------------------------

PUT {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"note": "a fine first gizlet"}
HTTP 200
[Captures]
score_awesome: jsonpath "$.score"
[Asserts]
jsonpath "$.marks" contains "awesome"
jsonpath "$.score" > {{score_plain}}

# scanned follows the scans; nobody sets it by hand.
PUT {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/scanned
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
HTTP 400
[Asserts]
jsonpath "$.error.message" contains "scan"

PUT {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/shiny
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
HTTP 400

PUT {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
x-gizlet-host: api.gizlet.io
HTTP 401

GET {{base}}/v1/gizlets?mark=awesome
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.gizlets[0].marks" contains "awesome"

GET {{base}}/v1/gizlets?mark=shiny
x-gizlet-host: api.gizlet.io
HTTP 400

# --- scanned: a clean malware scan of the newest ready release ------------------------------

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
revision: jsonpath "$.revision"
[Asserts]
jsonpath "$.scan" == null

# A scan of an older revision is refused: the tag was indexed again since.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"result": "clean", "revision": 999}
HTTP 409
[Asserts]
jsonpath "$.error.code" == "revision_changed"

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"result": "maybe"}
HTTP 400

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"result": "clean", "revision": {{revision}}, "engine": "ClamAV 1.4", "report_url": "https://scanner.example/r/1"}
HTTP 200
[Asserts]
jsonpath "$.scan.result" == "clean"
jsonpath "$.scan.engine" == "ClamAV 1.4"
jsonpath "$.scan.report_url" == "https://scanner.example/r/1"
jsonpath "$.scan.scanned_at" exists
jsonpath "$.marks" contains "scanned"

# Both marks show, in a fixed order, and each adds to the score.
GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.marks" count == 2
jsonpath "$.marks[0]" == "awesome"
jsonpath "$.marks[1]" == "scanned"
jsonpath "$.score" > {{score_awesome}}

GET {{base}}/v1/gizlets?mark=scanned
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

# --- An infected release is failed and served no more ---------------------------------------

GET {{base}}/v1/gizlets/github.com/fixture-org/infected
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/infected/releases/v1.0.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/infected/releases/v1.0.0/scan
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"result": "infected", "engine": "ClamAV 1.4", "note": "Linux.Trojan.Fixture"}
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "Linux.Trojan.Fixture"
jsonpath "$.scan.result" == "infected"

GET {{base}}/github.com/fixture-org/infected/v1.0.0/dev.fixture.infected-1.0.0-aarch64-unknown-linux-gnu-lite.gzl
x-gizlet-host: dl.gizlet.io
HTTP 410

GET {{base}}/v1/gizlets/github.com/fixture-org/infected
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.code" == "failed_checks"

# Publishing the same bytes again does not bring it back.
GET {{fixture}}/token?repo=fixture-org/infected&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
infected_token: jsonpath "$.value"

POST {{base}}/v1/publish
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{infected_token}}
{}
HTTP 202
[Asserts]
jsonpath "$.status" == "failed"

# --- Ratings ------------------------------------------------------------------------------------

POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "rater-{{run}}@example.com", "password": "correct horse battery", "name": "Rater", "callbackURL": "/account"}
HTTP 200

GET {{base}}/v1/dev/mail?to=rater-{{run}}@example.com
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
rater_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/v1/auth/verify-email?token={{rater_verify}}&callbackURL=%2Faccount
x-gizlet-host: gizlet.io
HTTP 302
[Captures]
rater: header "set-auth-token"

PUT {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
{"stars": 5}
HTTP 401

PUT {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
{"stars": 6}
HTTP 400

PUT {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
{"stars": 2.5}
HTTP 400

PUT {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
{"stars": 5}
HTTP 200
[Asserts]
jsonpath "$.stars" == 5
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 5

# Rating again replaces the rating; one per account.
PUT {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
{"stars": 4}
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 4

GET {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
HTTP 200
[Asserts]
jsonpath "$.stars" == 4
header "cache-control" == "no-store"

GET {{base}}/v1/me/ratings
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
HTTP 200
[Asserts]
jsonpath "$.ratings" count == 1
jsonpath "$.ratings[0].repo" == "github.com/fixture-org/hello-gizlet"

# The site's pages call it on gizlet.io too.
GET {{base}}/v1/me/ratings
x-gizlet-host: gizlet.io
Authorization: Bearer {{rater}}
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 4

GET {{base}}/v1/gizlets?sort=rating
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/gizlets?sort=score
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/gizlets?sort=stars
x-gizlet-host: api.gizlet.io
HTTP 400

# Only gizlets can be rated.
PUT {{base}}/v1/me/ratings/github.com/fixture-org/no-index
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
{"stars": 3}
HTTP 404

DELETE {{base}}/v1/me/ratings/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{rater}}
HTTP 204

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 0

# Unmarking takes the mark and its points away.
DELETE {{base}}/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$.marks" count == 1
jsonpath "$.marks[0]" == "scanned"

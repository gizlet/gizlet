# Marks (awesome, scanned), malware scans, ratings and the score.

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet
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

PUT {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
Authorization: Bearer {{admin_token}}
{"note": "a fine first gizlet"}
HTTP 200
[Captures]
score_awesome: jsonpath "$.score"
[Asserts]
jsonpath "$.marks" contains "awesome"
jsonpath "$.score" > {{score_plain}}

# scanned follows the scans; nobody sets it by hand.
PUT {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/scanned
Authorization: Bearer {{admin_token}}
HTTP 400
[Asserts]
jsonpath "$.error.message" contains "scan"

PUT {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/shiny
Authorization: Bearer {{admin_token}}
HTTP 400

PUT {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
HTTP 401

GET {{base}}/api/v1/gizlets?mark=awesome
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.gizlets[0].marks" contains "awesome"

GET {{base}}/api/v1/gizlets?mark=shiny
HTTP 400

# --- scanned: a clean malware scan of the newest ready release ------------------------------

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0
HTTP 200
[Captures]
revision: jsonpath "$.revision"
[Asserts]
jsonpath "$.scan" == null

# A scan of an older revision is refused: the tag was indexed again since.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
Authorization: Bearer {{admin_token}}
{"result": "clean", "revision": 999}
HTTP 409
[Asserts]
jsonpath "$.error.code" == "revision_changed"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
Authorization: Bearer {{admin_token}}
{"result": "maybe"}
HTTP 400

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/releases/v0.2.0/scan
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
GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.marks" count == 2
jsonpath "$.marks[0]" == "awesome"
jsonpath "$.marks[1]" == "scanned"
jsonpath "$.score" > {{score_awesome}}

GET {{base}}/api/v1/gizlets?mark=scanned
HTTP 200
[Asserts]
jsonpath "$.gizlets" count == 1
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

# --- An infected release is failed and served no more ---------------------------------------

GET {{base}}/api/v1/gizlets/github.com/fixture-org/infected
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/infected/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/infected/releases/v1.0.0/scan
Authorization: Bearer {{admin_token}}
{"result": "infected", "engine": "ClamAV 1.4", "note": "Linux.Trojan.Fixture"}
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "Linux.Trojan.Fixture"
jsonpath "$.scan.result" == "infected"

GET {{base}}/assets/github.com/fixture-org/infected/v1.0.0/dev.fixture.infected-1.0.0-aarch64-unknown-linux-gnu-lite.gzl
HTTP 410

GET {{base}}/api/v1/gizlets/github.com/fixture-org/infected
HTTP 404
[Asserts]
jsonpath "$.error.code" == "failed_checks"

# Publishing the same bytes again does not bring it back. A package's sha256 is learnt while it
# is mirrored, so the new revision is pending until then, and failed as soon as its bytes match.
GET {{fixture}}/token?repo=fixture-org/infected&ref=refs/tags/v1.0.0
HTTP 200
[Captures]
infected_token: jsonpath "$.value"

POST {{base}}/api/v1/publish
Authorization: Bearer {{infected_token}}
{}
HTTP 202

GET {{base}}/api/v1/gizlets/github.com/fixture-org/infected/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.revision" == 2
jsonpath "$.error" contains "Linux.Trojan.Fixture"

# Nor does a gizlet.toml that changes only its description around the same packages: the
# verdict belongs to their sha256.
POST {{fixture}}/_fixture/describe?repo=fixture-org/infected&tag=v1.0.0&description=Now%20with%20a%20new%20description
HTTP 200

POST {{base}}/api/v1/publish
Authorization: Bearer {{infected_token}}
{}
HTTP 202

GET {{base}}/api/v1/gizlets/github.com/fixture-org/infected/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.revision" == 3
jsonpath "$.error" contains "Linux.Trojan.Fixture"

GET {{base}}/assets/github.com/fixture-org/infected/v1.0.0/dev.fixture.infected-1.0.0-aarch64-unknown-linux-gnu-lite.gzl
HTTP 410

# The same bytes released elsewhere are quarantined with it: twin-b ships twin-a's files.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-a
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-a/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b/releases/v1.0.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Captures]
twin_sha: jsonpath "$.packages[0].sha256"
[Asserts]
jsonpath "$.status" == "ready"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-a/releases/v1.0.0
HTTP 200
[Asserts]
jsonpath "$.packages[0].sha256" == "{{twin_sha}}"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 200

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/twin-a/releases/v1.0.0/scan
Authorization: Bearer {{admin_token}}
{"result": "infected", "note": "Linux.Trojan.Twin"}
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b/releases/v1.0.0
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"
jsonpath "$.error" contains "Linux.Trojan.Twin"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b/install?target=aarch64-unknown-linux-gnu&tier=lite
HTTP 404

GET {{base}}/assets/github.com/fixture-org/twin-b/v1.0.0/dev.fixture.twina-1.0.0-aarch64-unknown-linux-gnu-lite.gzl
HTTP 410

# Reporting again redoes the follow-up work of every affected release, already failed or not.
POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/twin-a/releases/v1.0.0/scan
Authorization: Bearer {{admin_token}}
{"result": "infected", "note": "Linux.Trojan.Twin"}
HTTP 200
[Asserts]
jsonpath "$.status" == "failed"

GET {{base}}/api/v1/gizlets/github.com/fixture-org/twin-b
HTTP 404
[Asserts]
jsonpath "$.error.code" == "failed_checks"

# --- Ratings ------------------------------------------------------------------------------------

POST {{base}}/api/v1/auth/sign-up/email
Origin: {{site}}
{"email": "rater-{{run}}@example.com", "password": "correct horse battery", "name": "Rater", "callbackURL": "/account"}
HTTP 200

GET {{base}}/api/v1/dev/mail?to=rater-{{run}}@example.com
HTTP 200
[Captures]
rater_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/api/v1/auth/verify-email?token={{rater_verify}}&callbackURL=%2Faccount
HTTP 302
[Captures]
rater: header "set-auth-token"

PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
{"stars": 5}
HTTP 401

PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
{"stars": 6}
HTTP 400

PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
{"stars": 2.5}
HTTP 400

PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
{"stars": 5}
HTTP 200
[Asserts]
jsonpath "$.stars" == 5
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 5

# Rating again replaces the rating; one per account.
PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
{"stars": 4}
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 4

# A second account's rating adds to the aggregate.
POST {{base}}/api/v1/auth/sign-up/email
Origin: {{site}}
{"email": "rater2-{{run}}@example.com", "password": "correct horse battery", "name": "Rater 2", "callbackURL": "/account"}
HTTP 200

GET {{base}}/api/v1/dev/mail?to=rater2-{{run}}@example.com
HTTP 200
[Captures]
rater2_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/api/v1/auth/verify-email?token={{rater2_verify}}&callbackURL=%2Faccount
HTTP 302
[Captures]
rater2: header "set-auth-token"

PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater2}}
{"stars": 5}
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 2
jsonpath "$.rating.average" == 4.5

DELETE {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater2}}
HTTP 204

GET {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
HTTP 200
[Asserts]
jsonpath "$.stars" == 4
header "cache-control" == "no-store"

GET {{base}}/api/v1/me/ratings
Authorization: Bearer {{rater}}
HTTP 200
[Asserts]
jsonpath "$.ratings" count == 1
jsonpath "$.ratings[0].repo" == "github.com/fixture-org/hello-gizlet"

# The site's pages call it on gizlet.io too.
GET {{base}}/api/v1/me/ratings
Authorization: Bearer {{rater}}
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 1
jsonpath "$.rating.average" == 4

GET {{base}}/api/v1/gizlets?sort=rating
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/api/v1/gizlets?sort=score
HTTP 200
[Asserts]
jsonpath "$.gizlets[0].repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/api/v1/gizlets?sort=stars
HTTP 400

# Only gizlets can be rated.
PUT {{base}}/api/v1/me/ratings/github.com/fixture-org/no-index
Authorization: Bearer {{rater}}
{"stars": 3}
HTTP 404

DELETE {{base}}/api/v1/me/ratings/github.com/fixture-org/hello-gizlet
Authorization: Bearer {{rater}}
HTTP 204

GET {{base}}/api/v1/gizlets/github.com/fixture-org/hello-gizlet
HTTP 200
[Asserts]
jsonpath "$.rating.count" == 0

# Unmarking takes the mark and its points away.
DELETE {{base}}/api/v1/admin/gizlets/github.com/fixture-org/hello-gizlet/marks/awesome
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$.marks" count == 1
jsonpath "$.marks[0]" == "scanned"

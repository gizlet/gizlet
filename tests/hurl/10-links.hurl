# Short links (src/links.ts): an account links GitHub through the OAuth app (the fixture's
# GitHub), sets a short link on a gizlet it manages, and gizlet.io/<id> opens the gizlet's page.

GET {{base}}/v1/gizlets/github.com/fixture-org/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/rocket-snail
x-gizlet-host: api.gizlet.io
HTTP 200

# Indexed from the public web, so the registry has no GitHub repository id for it yet.
GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand
x-gizlet-host: api.gizlet.io
HTTP 200

# Private, read through the Gizlet App.
GET {{base}}/v1/gizlets/github.com/fixture-org/secret-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200

# Nothing there yet; ids that cannot be links say why.
GET {{base}}/v1/links/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.available" == true

GET {{base}}/v1/links/account
x-gizlet-host: api.gizlet.io
HTTP 400
[Asserts]
jsonpath "$.error.code" == "reserved"

GET {{base}}/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 404

# A developer signs up (after 09-wants' sign-up window lapses; see there).
POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
[Options]
delay: 10000
{"email": "dev-{{run}}@example.com", "password": "correct horse battery", "name": "Dev", "callbackURL": "/account"}
HTTP 200

GET {{base}}/v1/dev/mail?to=dev-{{run}}@example.com
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
dev_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/v1/auth/verify-email?token={{dev_verify}}&callbackURL=%2Faccount
x-gizlet-host: gizlet.io
HTTP 302
[Captures]
dev: header "set-auth-token"

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Captures]
dev_id: jsonpath "$.user.id"
[Asserts]
jsonpath "$.user.link_min_length" == 6
jsonpath "$.user.github_login" == null

# Without GitHub, no short links.
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello-gizlet"}
HTTP 403
[Asserts]
jsonpath "$.error.code" == "github_not_linked"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
{"id": "hello-gizlet"}
HTTP 401

# Linking GitHub: Better Auth sends the browser to GitHub's authorize page (the fixture's on local
# runs), which comes back to the callback with a code. The state cookie ties the two together.
POST {{base}}/v1/auth/link-social
x-gizlet-host: api.gizlet.io
Origin: {{site}}
Authorization: Bearer {{dev}}
{"provider": "github", "callbackURL": "/account#gizlets"}
HTTP 200
[Captures]
authorize: jsonpath "$.url"
state_cookie: cookie "better-auth.state"
[Asserts]
jsonpath "$.url" startsWith "{{fixture}}/login/oauth/authorize?"
jsonpath "$.url" contains "read%3Aorg"

GET {{authorize}}&fixture_login=fixture-dev
HTTP 302
[Captures]
code: header "Location" regex "code=([^&]+)"
state: header "Location" regex "state=([^&]+)"
[Asserts]
header "Location" startsWith "{{site}}/v1/auth/callback/github?"

GET {{base}}/v1/auth/callback/github?code={{code}}&state={{state}}
x-gizlet-host: gizlet.io
Cookie: better-auth.state={{state_cookie}}
HTTP 302
[Asserts]
header "Location" contains "/account#gizlets"
header "Location" not contains "error"

# The GitHub login and picture are the account's now, though the emails differ.
GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Captures]
github_account: jsonpath "$.accounts[?(@.provider == 'github')].id"
[Asserts]
jsonpath "$.user.github_login" == "fixture-dev"
jsonpath "$.user.email" == "dev-{{run}}@example.com"
jsonpath "$.user.image" startsWith "https://avatars.githubusercontent.com/"
jsonpath "$.sign_in_methods" contains "github"

# Gizlets of the user's organizations too, with whether they may set the link.
GET {{base}}/v1/me/gizlets
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
header "cache-control" == "no-store"
jsonpath "$.github_login" == "fixture-dev"
jsonpath "$.github" == "ok"
jsonpath "$.link_min_length" == 6
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')].can_link" == true
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')].checks" == "ready"
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')].link" == null

# Ids the account cannot have.
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello"}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "too_short"
jsonpath "$.error.min_length" == 6

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "explore"}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "reserved"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello--gizlet"}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "bad_link"

# Claiming one, written in any case.
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "Hello-Gizlet"}
HTTP 200
[Asserts]
jsonpath "$.id" == "hello-gizlet"
jsonpath "$.url" == "{{site}}/hello-gizlet"
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/hello-gizlet?utm_source=card
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet?utm_source=card"

GET {{base}}/HELLO-GIZLET
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

# A gizlet without a GitHub id takes the one the permission check returns (tests/unit/links.test.ts).
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/on-demand/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "on-demand-app"}
HTTP 200

GET {{base}}/on-demand-app
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/on-demand"

# The site's own paths still win.
GET {{base}}/explore
x-gizlet-host: gizlet.io
HTTP 200

GET {{base}}/v1/links/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.current" == true
jsonpath "$.share_url" == "{{site}}/github.com/fixture-org/hello-gizlet"

# The gizlet's page shows it.
GET {{base}}/github.com/fixture-org/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//a[@class='gz-short']/@href)" == "/hello-gizlet"
xpath "string(//a[@class='gz-short'])" == "gizlet.test/hello-gizlet"

# Changing it: the old id keeps leading there for 30 days, and nobody else can take it meanwhile.
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello-sushi"}
HTTP 200

GET {{base}}/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

GET {{base}}/hello-sushi
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

# Short links work wherever a repository address does: a console resolving what was typed, and the home page's box.
GET {{base}}/v1/resolve?url=https%3A%2F%2Fgizlet.test%2Fhello-sushi%3Fref%3Dcard
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"
jsonpath "$.short_link" == "hello-sushi"

GET {{base}}/v1/resolve?url=mirror.test%2FHello-Sushi
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/hello-gizlet"

GET {{base}}/v1/resolve?url=https%3A%2F%2Fevil.example%2Fhello-sushi
x-gizlet-host: api.gizlet.io
HTTP 400

GET {{base}}/v1/resolve?url=gizlet.test%2Fnobody-here
x-gizlet-host: api.gizlet.io
HTTP 404

GET {{base}}/open?url=gizlet.test%2Fhello-sushi
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

# A private repository: users' tokens cannot see it, so the Gizlet App reads their role there.
PUT {{base}}/v1/me/gizlets/github.com/fixture-org/secret-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "secret-stash"}
HTTP 200

GET {{base}}/secret-stash
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/secret-gizlet"

GET {{base}}/v1/links/hello-gizlet
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.current" == false
jsonpath "$.expires_at" isString

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello-gizlet"}
HTTP 409
[Asserts]
jsonpath "$.error.code" == "taken"

# One link per gizlet: the page and the account list show the new one.
GET {{base}}/v1/me/gizlets
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')].link.id" == "hello-sushi"

# The account page, rendered for the signed-in user.
GET {{base}}/account
x-gizlet-host: gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
header "cache-control" contains "no-store"
xpath "string(//h1)" == "Dev"
xpath "count(//*[@role='tab'])" == 5
xpath "count(//*[@role='tabpanel'])" == 5
xpath "string(//li[@data-repo='github.com/fixture-org/hello-gizlet']//input/@value)" == "hello-sushi"
xpath "string(//*[@data-min]/@data-min)" == "6"
body contains "@fixture-dev"

GET {{base}}/account
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/login?next=%2Faccount"

# A maintainer may set the link of a repository they maintain; pushing to one is not enough.
POST {{base}}/v1/auth/sign-up/email
x-gizlet-host: api.gizlet.io
Origin: {{site}}
{"email": "mae-{{run}}@example.com", "password": "correct horse battery", "name": "Mae", "callbackURL": "/account"}
HTTP 200

GET {{base}}/v1/dev/mail?to=mae-{{run}}@example.com
x-gizlet-host: api.gizlet.io
HTTP 200
[Captures]
mae_verify: jsonpath "$.link" regex "token=([^&]+)"

GET {{base}}/v1/auth/verify-email?token={{mae_verify}}&callbackURL=%2Faccount
x-gizlet-host: gizlet.io
HTTP 302
[Captures]
mae: header "set-auth-token"

POST {{base}}/v1/auth/link-social
x-gizlet-host: api.gizlet.io
Origin: {{site}}
Authorization: Bearer {{mae}}
{"provider": "github", "callbackURL": "/account#gizlets"}
HTTP 200
[Captures]
mae_authorize: jsonpath "$.url"
mae_state_cookie: cookie "better-auth.state"

GET {{mae_authorize}}&fixture_login=fixture-maintainer
HTTP 302
[Captures]
mae_code: header "Location" regex "code=([^&]+)"
mae_state: header "Location" regex "state=([^&]+)"

GET {{base}}/v1/auth/callback/github?code={{mae_code}}&state={{mae_state}}
x-gizlet-host: gizlet.io
Cookie: better-auth.state={{mae_state_cookie}}
HTTP 302
[Asserts]
header "Location" not contains "error"

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{mae}}
HTTP 200
[Asserts]
jsonpath "$.user.github_login" == "fixture-maintainer"

GET {{base}}/v1/me/gizlets
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{mae}}
HTTP 200
[Asserts]
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/hello-gizlet')].can_link" == true
jsonpath "$.gizlets[?(@.repo == 'github.com/fixture-org/rocket-snail')].can_link" == false

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{mae}}
{"id": "snail-mail"}
HTTP 403
[Asserts]
jsonpath "$.error.code" == "forbidden"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/secret-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{mae}}
{"id": "mae-secret"}
HTTP 403
[Asserts]
jsonpath "$.error.code" == "forbidden"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{mae}}
{"id": "mae-hello"}
HTTP 200

# An admin lowers the developer's minimum to 3 (by email; a user id works too).
PUT {{base}}/v1/admin/users/dev-{{run}}@example.com/link-min-length
x-gizlet-host: api.gizlet.io
{"min_length": 3}
HTTP 401

PUT {{base}}/v1/admin/users/dev-{{run}}@example.com/link-min-length
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"min_length": 2}
HTTP 400

PUT {{base}}/v1/admin/users/dev-{{run}}@example.com/link-min-length
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"min_length": 3}
HTTP 200
[Asserts]
jsonpath "$.user_id" == "{{dev_id}}"
jsonpath "$.link_min_length" == 3

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "zap"}
HTTP 200

# Raising it again keeps the ids the account has; only new ones must be longer.
PUT {{base}}/v1/admin/users/{{dev_id}}/link-min-length
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"min_length": 8}
HTTP 200

GET {{base}}/zap
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/rocket-snail"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "zoom"}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "too_short"
jsonpath "$.error.min_length" == 8

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
jsonpath "$.user.link_min_length" == 8

# Admins set any valid id, whoever has it; the gizlet's previous one is held.
PUT {{base}}/v1/admin/links/rs
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"repo": "github.com/fixture-org/rocket-snail"}
HTTP 400

PUT {{base}}/v1/admin/links/fun
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"repo": "https://github.com/Fixture-Org/rocket-snail"}
HTTP 200
[Asserts]
jsonpath "$.repo" == "github.com/fixture-org/rocket-snail"

PUT {{base}}/v1/admin/links/mae-hello
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"repo": "github.com/fixture-org/rocket-snail"}
HTTP 200

GET {{base}}/mae-hello
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/rocket-snail"

GET {{base}}/v1/links/zap
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.current" == false

# Taking one back frees it at once.
DELETE {{base}}/v1/admin/links/zap
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
HTTP 204

GET {{base}}/v1/links/zap
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.available" == true

# A blocked gizlet's links lead nowhere, and are not free either.
POST {{base}}/v1/admin/gizlets/github.com/fixture-org/rocket-snail/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "blocked", "reason": "test"}
HTTP 200

GET {{base}}/mae-hello
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/v1/links/mae-hello
x-gizlet-host: api.gizlet.io
HTTP 404
[Asserts]
jsonpath "$.error.available" == false

POST {{base}}/v1/admin/gizlets/github.com/fixture-org/rocket-snail/visibility
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"visibility": "auto"}
HTTP 200

GET {{base}}/mae-hello
x-gizlet-host: gizlet.io
HTTP 302

# Removing a link: held for the gizlet, so it still leads there.
DELETE {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 204

GET {{base}}/v1/links/mae-hello
x-gizlet-host: api.gizlet.io
HTTP 200
[Asserts]
jsonpath "$.current" == false

DELETE {{base}}/v1/me/gizlets/github.com/fixture-org/rocket-snail/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 404

# When GitHub stops accepting the token, the account is asked to link again.
POST {{fixture}}/_fixture/revoke?login=fixture-dev
HTTP 200

GET {{base}}/v1/me/gizlets
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
jsonpath "$.github" == "relink"

PUT {{base}}/v1/me/gizlets/github.com/fixture-org/hello-gizlet/link
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
{"id": "hello-again"}
HTTP 403
[Asserts]
jsonpath "$.error.code" == "github_relink"

# Unlinking GitHub unties the account from its repositories; the links stay.
POST {{base}}/v1/auth/unlink-account
x-gizlet-host: api.gizlet.io
Origin: {{site}}
Authorization: Bearer {{dev}}
{"accountId": "{{github_account}}", "providerId": "github"}
HTTP 200

GET {{base}}/v1/me
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{dev}}
HTTP 200
[Asserts]
jsonpath "$.user.github_login" == null
jsonpath "$.user.image" == null
jsonpath "$.sign_in_methods" not contains "github"

GET {{base}}/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 302

# The repository at a link's path is replaced by another (the old one deleted, another created
# there): on its next refresh the gizlet takes the new id, and the link leads nowhere.
# Before that it goes away for a while (deleted, or made private): the gizlet keeps its id, so its
# links lead there again once it is back.
POST {{fixture}}/_fixture/hide?repo=fixture-org/on-demand
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

# The refresh asked GitHub, which showed nothing there.
GET {{fixture}}/_fixture/hits?key=gone:fixture-org/on-demand
[Options]
retry: 20
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.count" > 0

POST {{fixture}}/_fixture/hide?repo=fixture-org/on-demand&hidden=0
HTTP 200

GET {{base}}/on-demand-app
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/on-demand"

POST {{fixture}}/_fixture/replace?repo=fixture-org/on-demand
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/on-demand
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

GET {{base}}/on-demand-app
x-gizlet-host: gizlet.io
[Options]
retry: 20
retry-interval: 250ms
HTTP 404

# A linked repository is renamed and another is created at its old path: the link follows the
# repository to its new name. An admin link on a gizlet published from Actions (so with its id).
PUT {{base}}/v1/admin/links/snail-home
x-gizlet-host: api.gizlet.io
Authorization: Bearer {{admin_token}}
{"repo": "github.com/fixture-org/rocket-snail"}
HTTP 200

POST {{fixture}}/_fixture/rename?repo=fixture-org/rocket-snail&to=fixture-org/rocket-snail-2
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/rocket-snail
x-gizlet-host: api.gizlet.io
[Options]
delay: 3500
HTTP 200

GET {{base}}/snail-home
x-gizlet-host: gizlet.io
[Options]
retry: 20
retry-interval: 250ms
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/rocket-snail-2"

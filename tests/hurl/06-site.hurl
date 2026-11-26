# gizlet.io pages.
GET {{base}}/
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-security-policy" contains "script-src 'self'"
xpath "string(//h1)" contains "One link."
body contains "href=\"/github.com/fixture-org/hello-gizlet\""
body not contains "fixture-org/on-demand"
body contains "/v1/publish"

# The home page's link box opens any way of writing a repository.
GET {{base}}/open?url=https%3A%2F%2Fgithub.com%2FFixture-Org%2Fhello-gizlet%2Freleases
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

GET {{base}}/open?url=%3Cb%3Enope
x-gizlet-host: gizlet.io
HTTP 400
[Asserts]
body contains "&lt;b&gt;nope"
body not contains "<b>nope"

GET {{base}}/github.com/fixture-org/hello-gizlet
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "Hello Gizlet"
body contains "aarch64-unknown-linux-gnu"

GET {{base}}/github.com/fixture-org/no-index
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/login
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body contains "/static/login.js"

GET {{base}}/device?user_code=ABCD%3Cscript%3E
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body not contains "ABCD<script>"
body contains "ABCD&lt;script&gt;"

GET {{base}}/static/device.js
HTTP 200
[Asserts]
body contains "/device/"

# www redirects to gizlet.io, keeping the path and query.
GET {{base}}/github.com/fixture-org/hello-gizlet?x=1
x-gizlet-host: www.gizlet.io
HTTP 301
[Asserts]
header "Location" == "{{site}}/github.com/fixture-org/hello-gizlet?x=1"

GET {{base}}/
x-gizlet-host: www.gizlet.io
HTTP 301

# Languages: English by default, then Accept-Language, the lang cookie and ?lang=.
GET {{base}}/
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-language" == "en"
header "vary" contains "Accept-Language"
xpath "string(/html/@lang)" == "en"
xpath "string(//footer//a[@aria-current])" == "English"

GET {{base}}/
x-gizlet-host: gizlet.io
accept-language: fr-FR, zh-HK;q=0.8, en;q=0.5
HTTP 200
[Asserts]
header "content-language" == "zh-TW"
xpath "string(//h1)" contains "一個連結"
header "set-cookie" not exists

GET {{base}}/
x-gizlet-host: gizlet.io
accept-language: zh-Hans-SG
HTTP 200
[Asserts]
xpath "string(/html/@lang)" == "zh-CN"
xpath "string(//h1)" contains "一个链接"
body contains "最新上架与更新"

# A bad ?lang= is ignored, and sets no cookie.
GET {{base}}/open?url=nope&lang=xx
x-gizlet-host: gizlet.io
accept-language: ja
HTTP 400
[Asserts]
body contains "は GitHub のリポジトリではありません"
header "set-cookie" not exists

# The lang cookie, as the language switcher leaves it; page scripts get their strings too.
GET {{base}}/login
x-gizlet-host: gizlet.io
accept-language: ja
[Cookies]
lang: zh-TW
HTTP 200
[Asserts]
xpath "string(//h1)" == "登入"
xpath "string(//script[@id='i18n'])" contains "建立帳號"

# ?lang= wins over Accept-Language and is remembered in a cookie.
GET {{base}}/?lang=ja
x-gizlet-host: gizlet.io
accept-language: zh-CN
HTTP 200
[Asserts]
xpath "string(/html/@lang)" == "ja"
xpath "string(//h1)" contains "リンクひとつ"
header "set-cookie" contains "lang=ja"

# A gizlet's own names are used for its language.
GET {{base}}/github.com/fixture-org/hello-gizlet?lang=zh-CN
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "你好 Gizlet"
body contains "测试用的示例。"

# No zh-TW name: the default, not the Simplified one.
GET {{base}}/github.com/fixture-org/hello-gizlet?lang=zh-TW
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "Hello Gizlet"

# gizlet.io pages.
GET {{base}}/
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-security-policy" contains "script-src 'self'"
xpath "string(//h1)" contains "One link."
body contains "href=\"/github.com/fixture-org/hello-gizlet\""
body not contains "fixture-org/on-demand"
body contains "gizlet/template"

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

# A gizlet's page, from its gizlet.toml (tests/fixtures/repos/overeaten): indexed on first sight,
# then shown once its packages are mirrored and checked.
GET {{base}}/v1/gizlets/github.com/fixture-org/overeaten
x-gizlet-host: api.gizlet.io
HTTP 200

GET {{base}}/v1/gizlets/github.com/fixture-org/overeaten/releases/v0.1.0
x-gizlet-host: api.gizlet.io
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.visibility" == "listed"

GET {{base}}/github.com/fixture-org/overeaten
x-gizlet-host: gizlet.io
Accept-Language: zh-CN
HTTP 200
[Asserts]
xpath "string(//h1)" == "吃吃吃"
xpath "string(//link[contains(@href, '/_theme/')]/@href)" == "/_theme/2/c8553d.css"
# The cartridge and the band take the colour from gizlet.toml.
xpath "string(//span[contains(@class, 'rig-cart')]/@class)" contains "theme-c8553d"
xpath "string(//section[contains(@class, 'gz-band')]/@class)" contains "theme-c8553d"
xpath "string(//section[contains(@class, 'gz-band')]/@class)" contains "has-pattern"
xpath "string(//link[contains(@href, '/_patterns.css')]/@href)" == "/_patterns.css?r=github.com%2Ffixture-org%2Fovereaten"
xpath "string(//span[contains(@class, 'rig-cart')]/@class)" contains "has-pattern"
xpath "string(//span[contains(@class, 'rig-cart')]//img/@src)" == "https://dl.gizlet.io/github.com/fixture-org/overeaten/v0.1.0/store/icon.png"
xpath "count(//div[@class='gz-shots']//img)" == 4
# What to enter on a device is the repository address, not a site URL.
xpath "string(//div[contains(@class, 'gz-get')]//pre)" == "github.com/fixture-org/overeaten"
xpath "string(//div[contains(@class, 'gz-get')]//button/@data-copy)" == "github.com/fixture-org/overeaten"
# The about page is the zh-CN Markdown, rendered on the server.
xpath "string(//div[@class='prose']/h3[1])" == "先买门票，再开吃"
xpath "string(//div[@class='prose']//strong[1])" == "转转寿司"
xpath "count(//ul[@class='gz-controls']/li)" == 6
# The developer's links, in the store's order, on their own domains.
xpath "count(//ul[@class='gz-links']/li)" == 4
xpath "string(//ul[@class='gz-links']/li[1]//b)" == "网站"
xpath "string(//ul[@class='gz-links']/li[2]/a/@href)" == "https://x.com/gizletio"
xpath "string(//ul[@class='gz-links']/li[3]/a/@href)" == "https://discord.gg/gizlet"
xpath "string(//ul[@class='gz-controls']/li[2])" contains "吃够得着的那盘"
body contains "io.gizlet.overeaten-0.1.0-aarch64-unknown-linux-gnu-lite.gzl?sha256="
body not contains "raw.githubusercontent.com"

# Pattern tiles come from the registry, never from the request; repositories without one are left out.
GET {{base}}/_patterns.css?r=github.com%2Ffixture-org%2Fovereaten&r=github.com%2Ffixture-org%2Fhello-gizlet&r=https%3A%2F%2Fevil.test
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-type" contains "text/css"
body matches /^\.pat-[0-9a-f]{8} \{ --pattern: image-set\(url\("https:\/\/dl\.gizlet\.io\/github\.com\/fixture-org\/overeaten\/v0\.1\.0\/store\/pattern\.png"\) 2x\); \}\n$/

GET {{base}}/github.com/fixture-org/overeaten/v0.1.0/store/pattern.png
x-gizlet-host: dl.gizlet.io
HTTP 200
[Asserts]
header "content-type" == "image/png"

GET {{base}}/_patterns.css
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/_theme/2/2fa37a-c8553d.css
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-type" contains "text/css"
header "cache-control" contains "immutable"
body contains ".theme-c8553d { --c: #c8553d; --g: #c8553d; --g-on: #ffffff; }"
body contains ".theme-2fa37a {"

GET {{base}}/_theme/2/c8553d.css%7Bx
x-gizlet-host: gizlet.io
HTTP 404

# An older version of the stylesheets is gone, not served stale.
GET {{base}}/_theme/1/c8553d.css
x-gizlet-host: gizlet.io
HTTP 404

# Explore links one stylesheet for the colours of the cartridges on it.
GET {{base}}/explore
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//link[contains(@href, '/_theme/')]/@href)" matches /^\/_theme\/2\/[0-9a-f-]+\.css$/
xpath "count(//a[contains(@class, 'cart') and contains(@class, 'theme-c8553d')])" == 1
xpath "count(//a[contains(@class, 'cart') and contains(@class, 'has-pattern')])" == 1
xpath "string(//link[contains(@href, '/_patterns.css')]/@href)" == "/_patterns.css?r=github.com%2Ffixture-org%2Fovereaten"

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

# The icon: linked from every page, and /favicon.ico for clients that ask for it unlinked.
GET {{base}}/
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body contains "href=\"/static/icon.svg\""
body contains "href=\"/static/apple-touch-icon.png\""

GET {{base}}/favicon.ico
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
header "content-type" contains "icon"
bytes count == 2272

GET {{base}}/static/icon.svg
HTTP 200
[Asserts]
header "content-type" contains "image/svg+xml"

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

# Devices: one table of handhelds; ?q= hides rows that do not match, ?status= filters.
GET {{base}}/install?lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "count(//table[@class='hh-table']//tr[@data-search])" > 10
xpath "string(//a[@href='/install/r36s'])" contains "R36S"
body contains "/static/devices.js"

GET {{base}}/install?q=rg351&lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "count(//tr[@data-search and not(@hidden)])" == 3

GET {{base}}/install?status=supported&lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "count(//tr[@data-search])" == 1

# A supported handheld's page gives one command that flashes it; /flash/ leads to the writer.
GET {{base}}/install/r36s?lang=zh-CN
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
xpath "string(//h1)" == "R36S"
body contains "/flash/r36s | bash"
body contains "/flash/r36s.ps1 | iex"
body contains "烧录 Gizlet OS"

GET {{base}}/install/rg351p
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/flash/r36s
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" == "https://raw.githubusercontent.com/gizlet/os/main/boards/gameconsole/r36s/flash.sh"

GET {{base}}/flash/r36s.ps1
x-gizlet-host: gizlet.io
HTTP 302
[Asserts]
header "Location" endsWith "/r36s/flash.ps1"

GET {{base}}/flash/nope
x-gizlet-host: gizlet.io
HTTP 404

GET {{base}}/explore?q=hello&lang=en
x-gizlet-host: gizlet.io
HTTP 200
[Asserts]
body contains "href=\"/github.com/fixture-org/hello-gizlet\""

# The old Devices address redirects to Install.
GET {{base}}/devices?q=rg351
x-gizlet-host: gizlet.io
HTTP 301
[Asserts]
header "Location" == "/install?q=rg351"

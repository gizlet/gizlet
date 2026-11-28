# gizlet.io pages.
GET {{base}}/
HTTP 200
[Asserts]
header "content-security-policy" contains "script-src 'self'"
xpath "string(//h1)" contains "One link."
body contains "href=\"/github.com/fixture-org/hello-gizlet\""
body not contains "fixture-org/on-demand"
body contains "gizlet/template"

# The home page's link box opens any way of writing a repository.
GET {{base}}/open?url=https%3A%2F%2Fgithub.com%2FFixture-Org%2Fhello-gizlet%2Freleases
HTTP 302
[Asserts]
header "Location" == "/github.com/fixture-org/hello-gizlet"

GET {{base}}/open?url=%3Cb%3Enope
HTTP 400
[Asserts]
body contains "&lt;b&gt;nope"
body not contains "<b>nope"

GET {{base}}/github.com/fixture-org/hello-gizlet
HTTP 200
[Asserts]
xpath "string(//h1)" == "Hello Gizlet"
body contains "aarch64-unknown-linux-gnu"

# A gizlet's page, from its gizlet.toml (tests/fixtures/repos/rocket-snail): indexed on first sight,
# then shown once its packages are mirrored and checked.
GET {{base}}/api/v1/gizlets/github.com/fixture-org/rocket-snail
HTTP 200

GET {{base}}/api/v1/gizlets/github.com/fixture-org/rocket-snail/releases/v0.1.0
[Options]
retry: 40
retry-interval: 250ms
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
jsonpath "$.visibility" == "unlisted"
jsonpath "$.visibility_reason" == "awaiting editorial approval"

POST {{base}}/api/v1/admin/gizlets/github.com/fixture-org/rocket-snail/visibility
Authorization: Bearer {{admin_token}}
{"visibility": "listed"}
HTTP 200
[Asserts]
jsonpath "$.visibility" == "listed"

GET {{base}}/github.com/fixture-org/rocket-snail
Accept-Language: zh-CN
HTTP 200
[Asserts]
xpath "string(//h1)" == "火箭蜗牛"
xpath "string(//link[contains(@href, '/_theme/')]/@href)" == "/_theme/2/7b4dff.css"
# The cartridge and the band take the colour from gizlet.toml.
xpath "string(//span[contains(@class, 'rig-cart')]/@class)" contains "theme-7b4dff"
xpath "string(//section[contains(@class, 'gz-band')]/@class)" contains "theme-7b4dff"
xpath "string(//section[contains(@class, 'gz-band')]/@class)" contains "has-pattern"
xpath "string(//link[contains(@href, '/_patterns.css')]/@href)" == "/_patterns.css?r=github.com%2Ffixture-org%2Frocket-snail"
xpath "string(//span[contains(@class, 'rig-cart')]/@class)" contains "has-pattern"
xpath "string(//span[contains(@class, 'rig-cart')]//img/@src)" == "https://gizlet.io/assets/github.com/fixture-org/rocket-snail/v0.1.0/store/icon.png"
xpath "count(//div[@class='gz-shots']//img)" == 4
# What to enter on a device is the repository address, not a site URL.
xpath "string(//div[contains(@class, 'gz-get')]//pre)" == "github.com/fixture-org/rocket-snail"
xpath "string(//div[contains(@class, 'gz-get')]//button/@data-copy)" == "github.com/fixture-org/rocket-snail"
# The about page is the zh-CN Markdown, rendered on the server.
xpath "string(//div[@class='prose']/h3[1])" == "慢？那是以前"
xpath "string(//div[@class='prose']//strong[1])" == "火箭蜗牛"
xpath "count(//ul[@class='gz-controls']/li)" == 6
# The developer's links, in the store's order, on their own domains.
xpath "count(//ul[@class='gz-links']/li)" == 4
xpath "string(//ul[@class='gz-links']/li[1]//b)" == "网站"
xpath "string(//ul[@class='gz-links']/li[2]/a/@href)" == "https://x.com/gizletio"
xpath "string(//ul[@class='gz-links']/li[3]/a/@href)" == "https://discord.gg/gizlet"
xpath "string(//ul[@class='gz-controls']/li[2])" contains "点火加速"
body contains "io.gizlet.rocket-snail-0.1.0-aarch64-unknown-linux-gnu-lite.gzl?sha256="
body not contains "raw.githubusercontent.com"

# Pattern tiles come from the registry, never from the request; repositories without one are left out.
GET {{base}}/_patterns.css?r=github.com%2Ffixture-org%2Frocket-snail&r=github.com%2Ffixture-org%2Fhello-gizlet&r=https%3A%2F%2Fevil.test
HTTP 200
[Asserts]
header "content-type" contains "text/css"
body matches /^\.pat-[0-9a-f]{8} \{ --pattern: image-set\(url\("https:\/\/gizlet\.io\/assets\/github\.com\/fixture-org\/rocket-snail\/v0\.1\.0\/store\/pattern\.png"\) 2x\); \}\n$/

GET {{base}}/assets/github.com/fixture-org/rocket-snail/v0.1.0/store/pattern.png
HTTP 200
[Asserts]
header "content-type" == "image/png"

GET {{base}}/_patterns.css
HTTP 404

GET {{base}}/_theme/2/2fa37a-7b4dff.css
HTTP 200
[Asserts]
header "content-type" contains "text/css"
header "cache-control" contains "immutable"
body contains ".theme-7b4dff { --c: #7b4dff; --g: #7b4dff; --g-on: #ffffff; }"
body contains ".theme-2fa37a {"

GET {{base}}/_theme/2/7b4dff.css%7Bx
HTTP 404

# An older version of the stylesheets is gone, not served stale.
GET {{base}}/_theme/1/7b4dff.css
HTTP 404

# Explore links one stylesheet for the colours of the cartridges on it.
GET {{base}}/explore
HTTP 200
[Asserts]
xpath "string(//link[contains(@href, '/_theme/')]/@href)" matches /^\/_theme\/2\/[0-9a-f-]+\.css$/
xpath "count(//a[contains(@class, 'cart') and contains(@class, 'theme-7b4dff')])" == 1
xpath "count(//a[contains(@class, 'cart') and contains(@class, 'has-pattern')])" == 1
xpath "string(//link[contains(@href, '/_patterns.css')]/@href)" == "/_patterns.css?r=github.com%2Ffixture-org%2Frocket-snail"

GET {{base}}/github.com/fixture-org/no-index
HTTP 404

GET {{base}}/login
HTTP 200
[Asserts]
body contains "/static/login.js"

GET {{base}}/device?user_code=ABCD%3Cscript%3E
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
HTTP 200
[Asserts]
body contains "href=\"/static/icon.svg\""
body contains "href=\"/static/apple-touch-icon.png\""

GET {{base}}/favicon.ico
HTTP 200
[Asserts]
header "content-type" contains "icon"
bytes count == 4632

GET {{base}}/static/icon.svg
HTTP 200
[Asserts]
header "content-type" contains "image/svg+xml"

# Languages: English by default, then Accept-Language, the lang cookie and ?lang=.
GET {{base}}/
HTTP 200
[Asserts]
header "content-language" == "en"
header "vary" contains "Accept-Language"
xpath "string(/html/@lang)" == "en"
xpath "string(//header//details[@class='langs']//a[@aria-current])" == "English"
xpath "count(//header//details[@class='langs']//a[@hreflang])" == 4

GET {{base}}/
accept-language: fr-FR, zh-HK;q=0.8, en;q=0.5
HTTP 200
[Asserts]
header "content-language" == "zh-TW"
xpath "string(//h1)" contains "一個連結"
header "set-cookie" not exists

GET {{base}}/
accept-language: zh-Hans-SG
HTTP 200
[Asserts]
xpath "string(/html/@lang)" == "zh-CN"
xpath "string(//h1)" contains "一个链接"
body contains "最新上架与更新"

# A bad ?lang= is ignored, and sets no cookie.
GET {{base}}/open?url=nope&lang=xx
accept-language: ja
HTTP 400
[Asserts]
body contains "は GitHub のリポジトリではありません"
header "set-cookie" not exists

# The lang cookie, as the language switcher leaves it; page scripts get their strings too.
GET {{base}}/login
accept-language: ja
[Cookies]
lang: zh-TW
HTTP 200
[Asserts]
xpath "string(//h1)" == "登入"
xpath "string(//script[@id='i18n'])" contains "建立帳號"

# ?lang= wins over Accept-Language and is remembered in a cookie.
GET {{base}}/?lang=ja
accept-language: zh-CN
HTTP 200
[Asserts]
xpath "string(/html/@lang)" == "ja"
xpath "string(//h1)" contains "リンクひとつ"
header "set-cookie" contains "lang=ja"

# A gizlet's own names are used for its language.
GET {{base}}/github.com/fixture-org/hello-gizlet?lang=zh-CN
HTTP 200
[Asserts]
xpath "string(//h1)" == "你好 Gizlet"
body contains "测试用的示例。"

# No zh-TW name: the default, not the Simplified one.
GET {{base}}/github.com/fixture-org/hello-gizlet?lang=zh-TW
HTTP 200
[Asserts]
xpath "string(//h1)" == "Hello Gizlet"

# Devices: one table of handhelds; ?q= hides rows that do not match, ?status= filters.
GET {{base}}/install?lang=en
HTTP 200
[Asserts]
xpath "count(//ul[@class='hh-list']/li[@data-search])" == 1
xpath "string(//a[@href='/install/r36s'])" contains "R36S"
xpath "count(//button[@class='want' and @data-device])" == 0
xpath "string(//li[@class='is-released']//a[contains(@href,'.img.gz')]/@href)" == "https://gizlet.io/assets/releases/v0.2.10/boards/gameconsole/r36s/gizlet-os-r36s.img.gz"
xpath "count(//div[@id='handheld-results']//table)" == 0
xpath "count(//section[@class='catalog-credits']//li)" == 4
xpath "string(//section[@id='handhelds']//nav[@class='tabs']/a[1])" == "Released"
xpath "string(//section[@id='handhelds']//nav[@class='tabs']/a[1]/@aria-current)" == "page"
xpath "string(//section[@id='handhelds']//nav[@class='tabs']/a[2])" == "Developing"
xpath "string(//section[@id='handhelds']//nav[@class='tabs']/a[3])" == "Voting"
xpath "string(//section[@id='handhelds']//nav[@class='tabs']/a[4])" == "Unpicked"
body contains "/static/devices.js"

GET {{base}}/install?status=all&q=rg351&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search and not(@hidden)])" == 3
xpath "count(//button[@class='want' and @data-device])" == 14

GET {{base}}/install?status=supported&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 1

GET {{base}}/install?status=catalog&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 40
xpath "count(//li[@class='is-released'])" == 0
xpath "count(//button[@class='want' and @data-device])" == 40
xpath "string(//nav[@class='catalog-pages']/a[@rel='next']/@href)" == "/install?status=unpicked&page=2#handhelds"

GET {{base}}/install?status=catalog&page=2&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 40
xpath "count(//li[@class='is-released'])" == 0
xpath "string(//nav[@class='catalog-pages']/span)" == "Page 2 of 15"

GET {{base}}/install?status=unpicked&q=SF2000&lang=en
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 1
xpath "count(//li[@data-search]//a[@href='https://handhelds.wiki/SF2000'])" == 1
xpath "count(//li[@data-search]//a[@href='https://handhelds.space/handhelds/data-frog-sf2000'])" == 1
xpath "string(//li[@data-search]//button/@data-device)" == "data-frog-sf2000"

GET {{base}}/install?status=catalog&q=BATLEXP+G350&lang=zh-CN
HTTP 200
[Asserts]
xpath "count(//li[@data-search])" == 1
xpath "count(//li[@data-search]/div[@class='hh-actions'])" == 1
body not contains "未公布计划"
body not contains "待评估"
xpath "count(//li[@data-search]//a[contains(@href, '.img.gz')])" == 0
body not contains "暂无镜像"
xpath "count(//li[@data-search]//a[@href='https://handhelds.wiki/BATLEXP_G350'])" == 1
xpath "count(//li[@data-search]//button[@data-device='batlexp-g350'])" == 1

GET {{base}}/install/rg351p
HTTP 404

GET {{base}}/explore?q=hello&lang=en
HTTP 200
[Asserts]
body contains "href=\"/github.com/fixture-org/hello-gizlet\""

# The old Devices address redirects to Install.
GET {{base}}/devices?q=rg351
HTTP 301
[Asserts]
header "Location" == "/install?q=rg351"

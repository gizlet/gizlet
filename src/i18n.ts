/**
 * The site's languages: English, Simplified Chinese, Traditional Chinese and Japanese.
 *
 * A page's language comes from `?lang=` (which also sets the `lang` cookie), else the cookie,
 * else Accept-Language, else English. Strings may carry a little markup, rendered by `rich`:
 * `code`, *emphasis* and [links](url). The `js` strings are handed to the page scripts.
 */
import { html, raw } from "hono/html";

export const LOCALES = ["en", "zh-CN", "zh-TW", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in itself, for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", "zh-CN": "简体中文", "zh-TW": "繁體中文", ja: "日本語" };

/** Map any language tag onto a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "en" || t.startsWith("en-")) return "en";
  if (t === "ja" || t.startsWith("ja-")) return "ja";
  if (t === "zh" || t.startsWith("zh-")) {
    // Traditional script, or a region that writes it, unless Simplified is named.
    if (/\bhans\b/.test(t)) return "zh-CN";
    if (/\bhant\b/.test(t) || /-(tw|hk|mo)\b/.test(t)) return "zh-TW";
    return "zh-CN";
  }
  return null;
}

/** The best supported locale from an Accept-Language header. */
export function negotiate(header: string | null | undefined): Locale {
  const prefs = (header ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: tag!, q: q === undefined ? 1 : Number(q), i };
    })
    .filter((p) => p.tag && p.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const p of prefs) {
    const l = matchLocale(p.tag);
    if (l) return l;
  }
  return DEFAULT_LOCALE;
}

/** Tags to try, in order, in a gizlet's own per-language map before its default text. */
const FALLBACKS: Record<Locale, string[]> = {
  en: ["en", "en-us", "en-gb"],
  "zh-CN": ["zh-cn", "zh-hans", "zh-hans-cn", "zh-sg", "zh"],
  "zh-TW": ["zh-tw", "zh-hant", "zh-hant-tw", "zh-hk", "zh-hant-hk", "zh"],
  ja: ["ja", "ja-jp"],
};

/** A gizlet's name, description or a collection title in this locale, from its language map. */
export function localized(map: Record<string, string> | null | undefined, fallback: string, lang: Locale): string;
export function localized(map: Record<string, string> | null | undefined, fallback: string | null, lang: Locale): string | null;
export function localized(map: Record<string, string> | null | undefined, fallback: string | null, lang: Locale): string | null {
  if (map) {
    const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    for (const tag of FALLBACKS[lang]) {
      const v = lower.get(tag);
      if (v) return v;
    }
  }
  return fallback;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Render a message's markup: `code`, *emphasis*, [text](url). The text is escaped first. */
export function rich(s: string) {
  return raw(
    escape(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>'),
  );
}

/** The page scripts' strings, as a JSON data block they read (not run, so the CSP allows it). */
export function scriptMessages(t: Messages) {
  return raw(`<script type="application/json" id="i18n">${JSON.stringify(t.js).replace(/</g, "\\u003c")}</script>`);
}

const REPO = "https://github.com/gizlet/gizlet";
const OS = "https://github.com/gizlet/os";

const en = {
  meta: {
    title: "Gizlet · Native games and apps for handhelds",
    description: "Gizlet turns handhelds into pocket computers: native Linux programs and games, released on GitHub and installed from their link.",
  },
  nav: { gizlets: "Gizlets", make: "Make", os: "Gizlet OS", account: "Account", home: "Gizlet home" },
  footer: { source: "Source", os: "Gizlet OS", language: "Language", keys: "Ⓐ Select · Ⓑ Back" },
  home: {
    stamp: "Open · No store tax",
    title: ["One link.", "One press.", "*Pocket* it."],
    lede: "Gizlet turns handhelds into pocket computers. Every gizlet is one native Linux program or game, released on GitHub and installed straight from its link.",
    browse: "Browse gizlets ▶",
    make: "Make a gizlet",
    featured: (name: string) => `Featured · ${name}`,
    openLabel: "Got a link?",
    openButton: "Open",
    openError: (url: string) => `"${url}" is not a GitHub repository. Try github.com/owner/repo.`,
    emptyTitle: "Fresh carts",
    emptyText: "Nothing on the shelf yet. The first gizlets appear here once they are published and pass their checks.",
    emptyButton: "Publish the first one",
    sections: { new: "New & updated", games: "Games", apps: "Apps & tools", popular: "Most downloaded" } as Record<string, string>,
    category: { game: "Game", app: "App" } as Record<string, string>,
    facts: ["No review to install", "No store tax", "Open source, Apache-2.0", "Rust · Go · Zig · C · Flutter", "Installs from a GitHub link"],
    howTitle: "How it works",
    steps: [
      { title: "Build", text: () => "Write it in Rust, Go, Zig, C, Flutter or anything that makes a native executable, with raylib, Slint or any UI engine." },
      { title: "Release", text: () => "Attach a `gizlet.json` and your `.gzl` packages to a GitHub release. Your workflow tells Gizlet, and the packages are mirrored and checked." },
      { title: "Share", text: (site: string) => `Send \`${site}/github.com/you/game\`. Open it on a handheld and it installs. No review, no waiting.` },
    ],
    devStamp: "For developers",
    devTitle: "Publish from GitHub Actions",
    devText:
      "No account and no API key. Gizlet trusts the workflow's OIDC token, so the repository proves who it is. Search and the featured lists show gizlets that pass the automated checks; installing by link works for any gizlet that is not blocked.",
    docs: "Read the docs",
    api: "API",
    codeComment: "# .github/workflows/release.yml, after the release assets are up",
    pillars: [
      { title: "No review to install", text: "Anyone with the link can install a gizlet, like a Go module or an npm package." },
      { title: "No store tax", text: "Developers will sell software and services through the platform directly." },
      { title: "Open", text: `Registry, downloads and accounts are [one open repository](${REPO}). The handheld OS is [gizlet/os](${OS}).` },
    ],
  },
  share: {
    notRepo: "Not a GitHub repository",
    noIndex: "This repository has no release with a `gizlet.json`.",
    blocked: "Blocked",
    removed: (reason: string) => `This gizlet has been removed: ${reason}.`,
    brokeRules: "it broke the rules",
    version: (v: string) => `Version ${v}`,
    unlisted: "unlisted",
    install: "Install",
    installText: "On a Gizlet device, open this link to install it. Packages:",
    notFound: "Not found",
  },
  login: { title: "Sign in", email: "Email", password: "Password", name: "Name", submit: "Sign in", toggle: "Create an account instead", github: "Continue with GitHub" },
  device: { title: "Connect a device", text: "Enter the code shown on your handheld.", code: "Code", allow: "Allow", deny: "Deny" },
  account: { title: "Account", methods: "Sign-in methods:", github: "GitHub:", link: "Link GitHub", signOut: "Sign out", gizlets: "Your gizlets" },
  /** For public/static/*.js; `{name}` placeholders are filled in there. */
  js: {
    signIn: "Sign in",
    createAccount: "Create account",
    toggleSignIn: "Create an account instead",
    toggleSignUp: "I already have an account",
    codeUsed: "This code has already been used.",
    deviceApproved: "Your device is signed in. You can close this page.",
    deviceDenied: "The request was denied.",
    loadFailed: "Could not load the account ({status}).",
    notLinked: "not linked",
    noRelease: "no release yet",
    noGizlets: "No gizlets in your repositories yet.",
    linkToSee: "Link GitHub to see the gizlets in your repositories.",
    requestFailed: "Something went wrong ({status}).",
    methods: { email: "Email", github: "GitHub" } as Record<string, string>,
    visibility: { listed: "listed", unlisted: "unlisted", blocked: "blocked" } as Record<string, string>,
    errors: {
      INVALID_EMAIL_OR_PASSWORD: "Wrong email or password.",
      INVALID_EMAIL: "That email address is not valid.",
      USER_ALREADY_EXISTS: "There is already an account with this email.",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "There is already an account with this email.",
      PASSWORD_TOO_SHORT: "The password must be at least 10 characters.",
    } as Record<string, string>,
  },
};

export type Messages = typeof en;

const zhCN: Messages = {
  meta: {
    title: "Gizlet · 掌机上的原生游戏与应用",
    description: "Gizlet 让掌机变成口袋电脑：原生 Linux 程序和游戏，在 GitHub 上发布，凭链接即可安装。",
  },
  nav: { gizlets: "浏览", make: "开发", os: "Gizlet OS", account: "账号", home: "Gizlet 首页" },
  footer: { source: "源代码", os: "Gizlet OS", language: "语言", keys: "Ⓐ 选择 · Ⓑ 返回" },
  home: {
    stamp: "开放 · 零抽成",
    title: ["一个链接。", "一键安装。", "*随身*带走。"],
    lede: "Gizlet 让掌机变成口袋电脑。每个 gizlet 都是一个原生 Linux 程序或游戏，在 GitHub 上发布，凭链接直接安装。",
    browse: "浏览 gizlet ▶",
    make: "开发 gizlet",
    featured: (name) => `精选 · ${name}`,
    openLabel: "有链接？",
    openButton: "打开",
    openError: (url) => `“${url}”不是 GitHub 仓库地址。试试 github.com/owner/repo。`,
    emptyTitle: "新卡带",
    emptyText: "货架上还空着。gizlet 发布并通过检查后，就会出现在这里。",
    emptyButton: "发布第一个",
    sections: { new: "最新上架与更新", games: "游戏", apps: "应用与工具", popular: "下载最多" },
    category: { game: "游戏", app: "应用" },
    facts: ["安装无需审核", "零平台抽成", "开源，Apache-2.0", "Rust · Go · Zig · C · Flutter", "凭 GitHub 链接安装"],
    howTitle: "如何运作",
    steps: [
      { title: "构建", text: () => "用 Rust、Go、Zig、C、Flutter 或任何能生成原生可执行文件的语言来写，搭配 raylib、Slint 或任意 UI 引擎。" },
      { title: "发布", text: () => "把 `gizlet.json` 和 `.gzl` 安装包附到 GitHub Release 上。工作流通知 Gizlet 后，安装包会被镜像并检查。" },
      { title: "分享", text: (site) => `发送 \`${site}/github.com/you/game\`，在掌机上打开即可安装。无需审核，无需等待。` },
    ],
    devStamp: "开发者",
    devTitle: "从 GitHub Actions 发布",
    devText: "无需账号，也无需 API 密钥。Gizlet 信任工作流的 OIDC 令牌，由仓库自己证明身份。搜索和精选列表只展示通过自动检查的 gizlet；凭链接安装则适用于任何未被封禁的 gizlet。",
    docs: "阅读文档",
    api: "API",
    codeComment: "# .github/workflows/release.yml，在 Release 附件上传之后",
    pillars: [
      { title: "安装无需审核", text: "任何拿到链接的人都能安装 gizlet，就像 Go 模块或 npm 包一样。" },
      { title: "零平台抽成", text: "开发者将可以直接通过平台出售软件和服务。" },
      { title: "开放", text: `注册表、下载和账号都在[一个开源仓库](${REPO})里。掌机系统是 [gizlet/os](${OS})。` },
    ],
  },
  share: {
    notRepo: "不是 GitHub 仓库",
    noIndex: "这个仓库没有带 `gizlet.json` 的 Release。",
    blocked: "已封禁",
    removed: (reason) => `此 gizlet 已被移除：${reason}。`,
    brokeRules: "违反了规则",
    version: (v) => `版本 ${v}`,
    unlisted: "仅链接可见",
    install: "安装",
    installText: "在 Gizlet 设备上打开此链接即可安装。安装包：",
    notFound: "页面不存在",
  },
  login: { title: "登录", email: "邮箱", password: "密码", name: "昵称", submit: "登录", toggle: "改为创建账号", github: "使用 GitHub 继续" },
  device: { title: "连接设备", text: "输入掌机上显示的代码。", code: "代码", allow: "允许", deny: "拒绝" },
  account: { title: "账号", methods: "登录方式：", github: "GitHub：", link: "关联 GitHub", signOut: "退出登录", gizlets: "我的 gizlet" },
  js: {
    signIn: "登录",
    createAccount: "创建账号",
    toggleSignIn: "改为创建账号",
    toggleSignUp: "我已有账号",
    codeUsed: "此代码已被使用。",
    deviceApproved: "设备已登录，可以关闭此页面。",
    deviceDenied: "已拒绝该请求。",
    loadFailed: "无法加载账号（{status}）。",
    notLinked: "未关联",
    noRelease: "尚未发布",
    noGizlets: "你的仓库里还没有 gizlet。",
    linkToSee: "关联 GitHub 后，可以看到你仓库中的 gizlet。",
    requestFailed: "出错了（{status}）。",
    methods: { email: "邮箱", github: "GitHub" },
    visibility: { listed: "已上架", unlisted: "仅链接可见", blocked: "已封禁" },
    errors: {
      INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误。",
      INVALID_EMAIL: "邮箱地址无效。",
      USER_ALREADY_EXISTS: "该邮箱已注册。",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册。",
      PASSWORD_TOO_SHORT: "密码至少需要 10 个字符。",
    },
  },
};

const zhTW: Messages = {
  meta: {
    title: "Gizlet · 掌機上的原生遊戲與應用程式",
    description: "Gizlet 讓掌機變成口袋電腦：原生 Linux 程式和遊戲，在 GitHub 上發布，憑連結即可安裝。",
  },
  nav: { gizlets: "瀏覽", make: "開發", os: "Gizlet OS", account: "帳號", home: "Gizlet 首頁" },
  footer: { source: "原始碼", os: "Gizlet OS", language: "語言", keys: "Ⓐ 選擇 · Ⓑ 返回" },
  home: {
    stamp: "開放 · 零抽成",
    title: ["一個連結。", "一鍵安裝。", "*隨身*帶走。"],
    lede: "Gizlet 讓掌機變成口袋電腦。每個 gizlet 都是一個原生 Linux 程式或遊戲，在 GitHub 上發布，憑連結直接安裝。",
    browse: "瀏覽 gizlet ▶",
    make: "開發 gizlet",
    featured: (name) => `精選 · ${name}`,
    openLabel: "有連結？",
    openButton: "打開",
    openError: (url) => `「${url}」不是 GitHub 儲存庫位址。試試 github.com/owner/repo。`,
    emptyTitle: "新卡帶",
    emptyText: "貨架上還空著。gizlet 發布並通過檢查後，就會出現在這裡。",
    emptyButton: "發布第一個",
    sections: { new: "最新上架與更新", games: "遊戲", apps: "應用程式與工具", popular: "下載最多" },
    category: { game: "遊戲", app: "應用程式" },
    facts: ["安裝免審核", "零平台抽成", "開源，Apache-2.0", "Rust · Go · Zig · C · Flutter", "憑 GitHub 連結安裝"],
    howTitle: "運作方式",
    steps: [
      { title: "建置", text: () => "用 Rust、Go、Zig、C、Flutter 或任何能產生原生執行檔的語言來寫，搭配 raylib、Slint 或任何 UI 引擎。" },
      { title: "發布", text: () => "把 `gizlet.json` 和 `.gzl` 安裝包附加到 GitHub Release。工作流程通知 Gizlet 後，安裝包會被鏡像並檢查。" },
      { title: "分享", text: (site) => `傳送 \`${site}/github.com/you/game\`，在掌機上打開就會安裝。免審核，免等待。` },
    ],
    devStamp: "開發者",
    devTitle: "從 GitHub Actions 發布",
    devText: "不需要帳號，也不需要 API 金鑰。Gizlet 信任工作流程的 OIDC 權杖，由儲存庫自己證明身分。搜尋和精選列表只顯示通過自動檢查的 gizlet；憑連結安裝則適用於任何未被封鎖的 gizlet。",
    docs: "閱讀文件",
    api: "API",
    codeComment: "# .github/workflows/release.yml，在 Release 附件上傳之後",
    pillars: [
      { title: "安裝免審核", text: "任何拿到連結的人都能安裝 gizlet，就像 Go 模組或 npm 套件一樣。" },
      { title: "零平台抽成", text: "開發者將可以直接透過平台販售軟體和服務。" },
      { title: "開放", text: `註冊表、下載和帳號都在[一個開源儲存庫](${REPO})裡。掌機系統是 [gizlet/os](${OS})。` },
    ],
  },
  share: {
    notRepo: "不是 GitHub 儲存庫",
    noIndex: "這個儲存庫沒有帶 `gizlet.json` 的 Release。",
    blocked: "已封鎖",
    removed: (reason) => `此 gizlet 已被移除：${reason}。`,
    brokeRules: "違反了規則",
    version: (v) => `版本 ${v}`,
    unlisted: "僅限連結",
    install: "安裝",
    installText: "在 Gizlet 裝置上打開此連結即可安裝。安裝包：",
    notFound: "找不到頁面",
  },
  login: { title: "登入", email: "電子郵件", password: "密碼", name: "名稱", submit: "登入", toggle: "改為建立帳號", github: "使用 GitHub 繼續" },
  device: { title: "連接裝置", text: "輸入掌機上顯示的代碼。", code: "代碼", allow: "允許", deny: "拒絕" },
  account: { title: "帳號", methods: "登入方式：", github: "GitHub：", link: "連結 GitHub", signOut: "登出", gizlets: "我的 gizlet" },
  js: {
    signIn: "登入",
    createAccount: "建立帳號",
    toggleSignIn: "改為建立帳號",
    toggleSignUp: "我已經有帳號",
    codeUsed: "此代碼已被使用。",
    deviceApproved: "裝置已登入，可以關閉此頁面。",
    deviceDenied: "已拒絕此請求。",
    loadFailed: "無法載入帳號（{status}）。",
    notLinked: "未連結",
    noRelease: "尚未發布",
    noGizlets: "你的儲存庫裡還沒有 gizlet。",
    linkToSee: "連結 GitHub 後，即可看到你儲存庫中的 gizlet。",
    requestFailed: "發生錯誤（{status}）。",
    methods: { email: "電子郵件", github: "GitHub" },
    visibility: { listed: "已上架", unlisted: "僅限連結", blocked: "已封鎖" },
    errors: {
      INVALID_EMAIL_OR_PASSWORD: "電子郵件或密碼錯誤。",
      INVALID_EMAIL: "電子郵件地址無效。",
      USER_ALREADY_EXISTS: "此電子郵件已註冊。",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "此電子郵件已註冊。",
      PASSWORD_TOO_SHORT: "密碼至少需要 10 個字元。",
    },
  },
};

const ja: Messages = {
  meta: {
    title: "Gizlet · 携帯ゲーム機のためのネイティブなゲームとアプリ",
    description: "Gizlet は携帯ゲーム機をポケットコンピューターに。ネイティブな Linux のプログラムやゲームを GitHub でリリースし、リンクからインストールできます。",
  },
  nav: { gizlets: "探す", make: "作る", os: "Gizlet OS", account: "アカウント", home: "Gizlet ホーム" },
  footer: { source: "ソースコード", os: "Gizlet OS", language: "言語", keys: "Ⓐ 決定 · Ⓑ 戻る" },
  home: {
    stamp: "オープン · 手数料ゼロ",
    title: ["リンクひとつ。", "ボタンひとつ。", "*ポケット*に。"],
    lede: "Gizlet は携帯ゲーム機をポケットコンピューターに変えます。gizlet はどれもネイティブな Linux のプログラムやゲームで、GitHub でリリースされ、リンクからそのままインストールできます。",
    browse: "gizlet を見る ▶",
    make: "gizlet を作る",
    featured: (name) => `注目 · ${name}`,
    openLabel: "リンクから開く",
    openButton: "開く",
    openError: (url) => `「${url}」は GitHub のリポジトリではありません。github.com/owner/repo の形で入力してください。`,
    emptyTitle: "新着カートリッジ",
    emptyText: "棚はまだ空です。公開されてチェックに通った gizlet が、ここに並びます。",
    emptyButton: "最初のひとつを公開する",
    sections: { new: "新着・アップデート", games: "ゲーム", apps: "アプリとツール", popular: "ダウンロード数上位" },
    category: { game: "ゲーム", app: "アプリ" },
    facts: ["インストールに審査なし", "ストア手数料ゼロ", "オープンソース（Apache-2.0）", "Rust · Go · Zig · C · Flutter", "GitHub のリンクからインストール"],
    howTitle: "しくみ",
    steps: [
      { title: "ビルド", text: () => "Rust、Go、Zig、C、Flutter など、ネイティブ実行ファイルを作れるものなら何でも。UI は raylib、Slint、そのほか好きなエンジンで。" },
      { title: "リリース", text: () => "`gizlet.json` と `.gzl` パッケージを GitHub のリリースに添付します。ワークフローが Gizlet に知らせると、パッケージがミラーされ、チェックされます。" },
      { title: "シェア", text: (site) => `\`${site}/github.com/you/game\` を送るだけ。携帯機で開けばインストールされます。審査も待ち時間もありません。` },
    ],
    devStamp: "開発者向け",
    devTitle: "GitHub Actions から公開",
    devText: "アカウントも API キーも不要です。Gizlet はワークフローの OIDC トークンを信頼するので、リポジトリ自身が身元を証明します。検索とおすすめに並ぶのは自動チェックに通った gizlet だけですが、リンクからのインストールはブロックされていないすべての gizlet で使えます。",
    docs: "ドキュメントを読む",
    api: "API",
    codeComment: "# .github/workflows/release.yml（リリースのアセットをアップロードした後）",
    pillars: [
      { title: "インストールに審査なし", text: "リンクを知っていれば、誰でも gizlet をインストールできます。Go モジュールや npm パッケージと同じです。" },
      { title: "ストア手数料ゼロ", text: "開発者はプラットフォームを通じて、ソフトウェアやサービスを直接販売できるようになります。" },
      { title: "オープン", text: `レジストリ、ダウンロード、アカウントはすべて[ひとつのオープンなリポジトリ](${REPO})にあります。携帯機向けの OS は [gizlet/os](${OS}) です。` },
    ],
  },
  share: {
    notRepo: "GitHub のリポジトリではありません",
    noIndex: "このリポジトリには `gizlet.json` を含むリリースがありません。",
    blocked: "ブロック済み",
    removed: (reason) => `この gizlet は削除されました：${reason}。`,
    brokeRules: "ルール違反のため",
    version: (v) => `バージョン ${v}`,
    unlisted: "リンク限定",
    install: "インストール",
    installText: "Gizlet のデバイスでこのリンクを開くと、インストールされます。パッケージ：",
    notFound: "ページが見つかりません",
  },
  login: { title: "ログイン", email: "メールアドレス", password: "パスワード", name: "名前", submit: "ログイン", toggle: "アカウントを作成する", github: "GitHub で続ける" },
  device: { title: "デバイスを接続", text: "携帯機に表示されたコードを入力してください。", code: "コード", allow: "許可", deny: "拒否" },
  account: { title: "アカウント", methods: "ログイン方法：", github: "GitHub：", link: "GitHub を連携", signOut: "ログアウト", gizlets: "あなたの gizlet" },
  js: {
    signIn: "ログイン",
    createAccount: "アカウントを作成",
    toggleSignIn: "アカウントを作成する",
    toggleSignUp: "アカウントをお持ちの方",
    codeUsed: "このコードはすでに使用されています。",
    deviceApproved: "デバイスがログインしました。このページは閉じてかまいません。",
    deviceDenied: "リクエストを拒否しました。",
    loadFailed: "アカウントを読み込めませんでした（{status}）。",
    notLinked: "未連携",
    noRelease: "リリースなし",
    noGizlets: "あなたのリポジトリには、まだ gizlet がありません。",
    linkToSee: "GitHub を連携すると、あなたのリポジトリの gizlet が表示されます。",
    requestFailed: "エラーが発生しました（{status}）。",
    methods: { email: "メールアドレス", github: "GitHub" },
    visibility: { listed: "公開中", unlisted: "リンク限定", blocked: "ブロック済み" },
    errors: {
      INVALID_EMAIL_OR_PASSWORD: "メールアドレスまたはパスワードが違います。",
      INVALID_EMAIL: "メールアドレスが正しくありません。",
      USER_ALREADY_EXISTS: "このメールアドレスはすでに登録されています。",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "このメールアドレスはすでに登録されています。",
      PASSWORD_TOO_SHORT: "パスワードは 10 文字以上にしてください。",
    },
  },
};

export const MESSAGES: Record<Locale, Messages> = { en, "zh-CN": zhCN, "zh-TW": zhTW, ja };

/** Hero title lines, with the *emphasis* markup. */
export const heroTitle = (t: Messages) => html`${t.home.title.map((line, i) => html`${i ? raw("<br>") : ""}${rich(line)}`)}`;

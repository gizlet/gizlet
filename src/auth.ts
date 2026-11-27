/**
 * Gizlet accounts: Better Auth on Postgres (Neon through Hyperdrive), mounted at /api/v1/auth for
 * browser and device clients.
 *
 * Sign-in: email + password, GitHub, and the OAuth device flow (RFC 8628) for consoles:
 * the console shows a code, the user approves it at gizlet.io/device, and the console gets a
 * bearer token for the same account.
 *
 * An email account has no session until its address is confirmed: sign-up mails a link, and
 * opening it verifies the address and signs the user in. Signing in unconfirmed mails a new one.
 * Changing the address mails a link to the new one, and the change happens once it is opened.
 *
 * Sessions a console got through the device flow carry its client id, so the account page can
 * list the devices signed in and sign each out.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { Pool } from "pg";
// With its extension: Node runs this file too (tests, scripts/pg.ts).
import { MESSAGES, requestLocale } from "./i18n.ts";
import { DEFAULT_LINK_MIN_LENGTH } from "./links.ts";

/** The settings auth needs; a subset of the Worker's Env so scripts can build the same schema. */
export interface AuthEnv {
  SITE_ORIGIN: string;
  GITHUB_API: string;
  /** github.com, or the fixture server on local runs. */
  GITHUB_WEB?: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Cloudflare Email Sending, from MAIL_FROM. */
  MAIL?: SendEmail;
  MAIL_FROM: string;
  /**
   * The domains links in our emails may use, comma-separated: "gizlet.io,gizlet.xyz". Each email
   * links to the domain its request came in on, if listed; else to SITE_ORIGIN.
   */
  SITE_DOMAINS?: string;
  /** "1" for local runs (pnpm dev, tests): account emails are logged and kept in devOutbox instead of sent. */
  DEV_HOST_OVERRIDE?: string;
}

/** Device flow clients: Gizlet OS and the gizlet CLI. */
export const DEVICE_CLIENTS = ["gizlet-os", "gizlet-cli"];

/**
 * Whether account emails can go out: through Cloudflare Email Sending, or into the log on local
 * runs. Mail carries sign-in links, so production never logs it.
 */
function canSendMail(env: AuthEnv): boolean {
  return Boolean(env.MAIL) || env.DEV_HOST_OVERRIDE === "1";
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Mail of local runs, newest last, for the tests to follow links in (GET /api/v1/dev/mail). */
export const devOutbox: Mail[] = [];

/** "Name <address>" or a bare address. */
export function parseAddress(s: string): { name: string; email: string } | string {
  const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(s);
  return m ? { name: m[1]!.replace(/^"|"$/g, ""), email: m[2]! } : s.trim();
}

async function sendMail(env: AuthEnv, mail: Mail): Promise<void> {
  if (env.DEV_HOST_OVERRIDE === "1") {
    console.log(`mail to ${mail.to}: ${mail.subject}\n${mail.text}`);
    devOutbox.push({ ...mail, to: mail.to.toLowerCase() });
    if (devOutbox.length > 200) devOutbox.shift();
    return;
  }
  if (!env.MAIL) throw new Error("mail is not configured");
  await env.MAIL.send({ from: parseAddress(env.MAIL_FROM), to: mail.to, subject: mail.subject, text: mail.text });
}

/** Account emails in the language of the request that caused them. */
const mailText = (request: Request | undefined) => MESSAGES[requestLocale(request?.headers)].mail;

/** SITE_DOMAINS as bare lowercase domains; "https://" and trailing slashes are allowed there. */
export function siteDomains(env: Pick<AuthEnv, "SITE_DOMAINS">): string[] {
  return (env.SITE_DOMAINS ?? "")
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * The origin for links in an email: the domain its request came in on, if SITE_DOMAINS lists it,
 * else SITE_ORIGIN. A proxy in front of the Worker (mirror/) names its domain in
 * X-Forwarded-Host. Anyone can run one, or send that header, so only listed domains are used:
 * the links carry sign-in and reset tokens.
 */
export function linkOrigin(env: Pick<AuthEnv, "SITE_ORIGIN" | "SITE_DOMAINS">, request: Request | undefined): string {
  if (!request) return env.SITE_ORIGIN;
  const host = (request.headers.get("x-forwarded-host")?.split(",")[0] ?? new URL(request.url).hostname).trim().toLowerCase();
  for (const d of siteDomains(env)) if (host === d || host === `api.${d}` || host === `www.${d}`) return `https://${d}`;
  return env.SITE_ORIGIN;
}

/** A link Better Auth built on SITE_ORIGIN, moved to the request's domain (see linkOrigin). */
const mailLink = (env: AuthEnv, url: string, request: Request | undefined) =>
  url.startsWith(`${env.SITE_ORIGIN}/`) ? linkOrigin(env, request) + url.slice(env.SITE_ORIGIN.length) : url;

/**
 * Keep the user's GitHub login and picture current. The login ties the account to the gizlets in
 * their repositories; the picture is the account's.
 */
async function syncGithubLogin(env: AuthEnv, pool: Pool, account: { providerId: string; userId: string; accessToken?: string | null }): Promise<void> {
  if (account.providerId !== "github" || !account.accessToken) return;
  const res = await fetch(`${env.GITHUB_API}/user`, {
    headers: { authorization: `Bearer ${account.accessToken}`, accept: "application/vnd.github+json", "user-agent": "gizlet (+https://gizlet.io)" },
  });
  if (!res.ok) return;
  const { login, avatar_url } = (await res.json()) as { login?: string; avatar_url?: string };
  if (typeof login !== "string") return;
  const image = typeof avatar_url === "string" && /^https:\/\//.test(avatar_url) ? avatar_url : null;
  await pool.query(`UPDATE "user" SET "githubLogin" = $1, image = coalesce($2, image) WHERE id = $3`, [login, image, account.userId]);
}

/** Unlinking GitHub unties the account from its repositories and drops the GitHub picture. */
async function forgetGithub(pool: Pool, account: { providerId: string; userId: string }): Promise<void> {
  if (account.providerId === "github") await pool.query(`UPDATE "user" SET "githubLogin" = NULL, image = NULL WHERE id = $1`, [account.userId]);
}

/**
 * Local runs only: Better Auth talks to github.com and api.github.com directly, so send those
 * requests to the fixture server (GITHUB_WEB, GITHUB_API) instead. The browser's trip to GitHub's
 * authorize page is rewritten the same way (devGithubResponse in src/api.ts).
 */
export function devGithubUrl(env: Pick<AuthEnv, "GITHUB_WEB" | "GITHUB_API">, url: string): string {
  if (env.GITHUB_WEB && url.startsWith("https://github.com/")) return `${env.GITHUB_WEB}/${url.slice("https://github.com/".length)}`;
  if (url.startsWith("https://api.github.com/") && env.GITHUB_API !== "https://api.github.com") return `${env.GITHUB_API}/${url.slice("https://api.github.com/".length)}`;
  return url;
}

let devEnv: AuthEnv | null = null;
function useDevGithub(env: AuthEnv) {
  if (env.DEV_HOST_OVERRIDE !== "1") return;
  if (!devEnv) {
    const real = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const to = devEnv ? devGithubUrl(devEnv, url) : url;
      if (to === url) return real(input, init);
      return real(input instanceof Request ? new Request(to, input) : to, init);
    };
  }
  devEnv = env;
}

export function authOptions(env: AuthEnv, pool: Pool): BetterAuthOptions {
  const site = new URL(env.SITE_ORIGIN);
  const github = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : null;
  return {
    appName: "Gizlet",
    baseURL: env.SITE_ORIGIN,
    basePath: "/api/v1/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [env.SITE_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // No session until the address is confirmed. Signing up again with a taken address
      // answers like a new sign-up (no account enumeration) and mails the owner instead.
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onExistingUserSignUp: async ({ user }, request) => {
        const t = mailText(request);
        await sendMail(env, { to: user.email, subject: t.existingSubject, text: t.existingText(`${linkOrigin(env, request)}/login`) });
      },
      // Without it, Better Auth answers password-reset requests with an error instead.
      sendResetPassword: canSendMail(env)
        ? async ({ user, url }, request) => {
            const t = mailText(request);
            await sendMail(env, { to: user.email, subject: t.resetSubject, text: t.resetText(mailLink(env, url, request)) });
          }
        : undefined,
      // The reset link went to the address, so it is confirmed too.
      onPasswordReset: async ({ user }) => {
        await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [user.id]);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: canSendMail(env)
        ? async ({ user, url }, request) => {
            const t = mailText(request);
            // A confirmed account asking for this is changing its address; `user.email` is the new one.
            const change = user.emailVerified === true;
            await sendMail(env, {
              to: user.email,
              subject: change ? t.changeSubject : t.verifySubject,
              text: (change ? t.changeText : t.verifyText)(mailLink(env, url, request)),
            });
          }
        : undefined,
    },
    // read:org, besides the provider's read:user and user:email, lists the organizations whose gizlets the account may manage.
    socialProviders: github ? { github: { ...github, scope: ["read:org"] } } : {},
    account: {
      // Signing in with GitHub never joins an existing account by email: an unverified
      // password account could otherwise capture it. Users link GitHub while signed in.
      // Linking needs a session, so the GitHub account's email may differ from the account's.
      accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: ["github"], allowDifferentEmails: true },
    },
    user: {
      changeEmail: { enabled: true },
      additionalFields: {
        githubLogin: { type: "string", required: false, input: false },
        // The shortest short link (src/links.ts) the account may claim; admins change it.
        linkMinLength: { type: "number", required: false, input: false, defaultValue: DEFAULT_LINK_MIN_LENGTH },
      },
    },
    session: {
      additionalFields: {
        // The device flow client (src/auth.ts DEVICE_CLIENTS) of a console's session; null for browsers.
        clientId: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      account: {
        create: { after: async (a) => syncGithubLogin(env, pool, a) },
        update: { after: async (a) => syncGithubLogin(env, pool, a) },
        delete: { after: async (a) => forgetGithub(pool, a) },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const clientId = ctx?.path === "/device/token" ? (ctx.body as { client_id?: unknown } | undefined)?.client_id : undefined;
            if (typeof clientId === "string" && DEVICE_CLIENTS.includes(clientId)) return { data: { ...session, clientId } };
          },
        },
      },
    },
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      // Cookies for gizlet.io and its subdomains; devices use bearer tokens instead.
      crossSubDomainCookies: site.hostname === "localhost" || site.hostname === "127.0.0.1" ? { enabled: false } : { enabled: true, domain: site.hostname },
      useSecureCookies: site.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      bearer(),
      deviceAuthorization({
        verificationUri: `${env.SITE_ORIGIN}/device`,
        expiresIn: "15m",
        interval: "5s",
        validateClient: (id) => DEVICE_CLIENTS.includes(id),
      }),
    ],
  };
}

/** One Better Auth instance per request: Workers cannot share a database connection between requests. */
export function createAuth(env: AuthEnv & { HYPERDRIVE: Hyperdrive }) {
  useDevGithub(env);
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return { auth: betterAuth(authOptions(env, pool)), pool, close: () => pool.end().catch(() => {}) };
}

export type Auth = ReturnType<typeof createAuth>["auth"];

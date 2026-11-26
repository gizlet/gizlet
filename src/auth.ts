/**
 * Gizlet accounts: Better Auth on Postgres (Neon through Hyperdrive), mounted at /v1/auth on
 * gizlet.io (browsers, cookies) and api.gizlet.io (devices and apps, bearer tokens).
 *
 * Sign-in: email + password, GitHub, and the OAuth device flow (RFC 8628) for consoles:
 * the console shows a code, the user approves it at gizlet.io/device, and the console gets a
 * bearer token for the same account.
 *
 * An email account has no session until its address is confirmed: sign-up mails a link, and
 * opening it verifies the address and signs the user in. Signing in unconfirmed mails a new one.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { Pool } from "pg";
// With its extension: Node runs this file too (tests, scripts/pg.ts).
import { MESSAGES, requestLocale } from "./i18n.ts";

/** The settings auth needs; a subset of the Worker's Env so scripts can build the same schema. */
export interface AuthEnv {
  SITE_ORIGIN: string;
  API_ORIGIN: string;
  GITHUB_API: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Cloudflare Email Sending, from MAIL_FROM. */
  MAIL?: SendEmail;
  MAIL_FROM: string;
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

/** Mail of local runs, newest last, for the tests to follow links in (GET /v1/dev/mail). */
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

/** Keep the user's GitHub login current; it ties the account to the gizlets in their repositories. */
async function syncGithubLogin(env: AuthEnv, pool: Pool, account: { providerId: string; userId: string; accessToken?: string | null }): Promise<void> {
  if (account.providerId !== "github" || !account.accessToken) return;
  const res = await fetch(`${env.GITHUB_API}/user`, {
    headers: { authorization: `Bearer ${account.accessToken}`, accept: "application/vnd.github+json", "user-agent": "gizlet (+https://gizlet.io)" },
  });
  if (!res.ok) return;
  const { login } = (await res.json()) as { login?: string };
  if (typeof login === "string") await pool.query(`UPDATE "user" SET "githubLogin" = $1 WHERE id = $2`, [login, account.userId]);
}

export function authOptions(env: AuthEnv, pool: Pool): BetterAuthOptions {
  const site = new URL(env.SITE_ORIGIN);
  const github = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : null;
  return {
    appName: "Gizlet",
    baseURL: env.SITE_ORIGIN,
    basePath: "/v1/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [env.SITE_ORIGIN, env.API_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // No session until the address is confirmed. Signing up again with a taken address
      // answers like a new sign-up (no account enumeration) and mails the owner instead.
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onExistingUserSignUp: async ({ user }, request) => {
        const t = mailText(request);
        await sendMail(env, { to: user.email, subject: t.existingSubject, text: t.existingText(`${env.SITE_ORIGIN}/login`) });
      },
      // Without it, Better Auth answers password-reset requests with an error instead.
      sendResetPassword: canSendMail(env)
        ? async ({ user, url }, request) => {
            const t = mailText(request);
            await sendMail(env, { to: user.email, subject: t.resetSubject, text: t.resetText(url) });
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
            await sendMail(env, { to: user.email, subject: t.verifySubject, text: t.verifyText(url) });
          }
        : undefined,
    },
    socialProviders: github ? { github: { ...github, scope: ["read:user", "user:email"] } } : {},
    account: {
      // Signing in with GitHub never joins an existing account by email: an unverified
      // password account could otherwise capture it. Users link GitHub while signed in.
      accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: ["github"] },
    },
    user: {
      additionalFields: {
        githubLogin: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      account: {
        create: { after: async (a) => syncGithubLogin(env, pool, a) },
        update: { after: async (a) => syncGithubLogin(env, pool, a) },
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
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return { auth: betterAuth(authOptions(env, pool)), pool, close: () => pool.end().catch(() => {}) };
}

export type Auth = ReturnType<typeof createAuth>["auth"];

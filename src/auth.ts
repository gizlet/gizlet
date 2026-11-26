/**
 * Gizlet accounts: Better Auth on Postgres (Neon through Hyperdrive), mounted at /v1/auth on
 * gizlet.io (browsers, cookies) and api.gizlet.io (devices and apps, bearer tokens).
 *
 * Sign-in: email + password, GitHub, and the OAuth device flow (RFC 8628) for consoles:
 * the console shows a code, the user approves it at gizlet.io/device, and the console gets a
 * bearer token for the same account.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { Pool } from "pg";

/** The settings auth needs; a subset of the Worker's Env so scripts can build the same schema. */
export interface AuthEnv {
  SITE_ORIGIN: string;
  API_ORIGIN: string;
  GITHUB_API: string;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  POSTMARK_TOKEN?: string;
  MAIL_FROM: string;
  /** "1" for local runs (pnpm dev, tests): account emails are logged instead of sent. */
  DEV_HOST_OVERRIDE?: string;
}

/** Device flow clients: Gizlet OS and the gizlet CLI. */
export const DEVICE_CLIENTS = ["gizlet-os", "gizlet-cli"];

/**
 * Whether account emails can go out: through Postmark, or into the log on local runs. Mail
 * carries reset links, so production never logs it; without Postmark it has no password reset.
 */
function canSendMail(env: AuthEnv): boolean {
  return Boolean(env.POSTMARK_TOKEN) || env.DEV_HOST_OVERRIDE === "1";
}

async function sendMail(env: AuthEnv, to: string, subject: string, text: string): Promise<void> {
  if (!env.POSTMARK_TOKEN) {
    if (env.DEV_HOST_OVERRIDE !== "1") throw new Error("mail is not configured");
    console.log(`mail to ${to}: ${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-postmark-server-token": env.POSTMARK_TOKEN },
    body: JSON.stringify({ From: env.MAIL_FROM, To: to, Subject: subject, TextBody: text, MessageStream: "outbound" }),
  });
  if (!res.ok) console.error(`postmark answered ${res.status}: ${await res.text()}`);
}

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
      revokeSessionsOnPasswordReset: true,
      // Without it, Better Auth answers password-reset requests with an error instead.
      sendResetPassword: canSendMail(env) ? async ({ user, url }) => sendMail(env, user.email, "Reset your Gizlet password", `Open this link to choose a new password:\n\n${url}\n\nIf you did not ask for this, ignore this email.`) : undefined,
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

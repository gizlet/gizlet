export interface Env {
  /** The registry: gizlets, releases, packages, collections. */
  DB: D1Database;
  /** Mirrored packages and store art, keyed github.com/<owner>/<repo>/<tag>/<file>. */
  BUCKET: R2Bucket;
  MIRROR: Queue<MirrorJob>;
  /** Accounts (Better Auth) in Neon Postgres. */
  HYPERDRIVE: Hyperdrive;

  SITE_ORIGIN: string;
  DL_ORIGIN: string;
  API_ORIGIN: string;
  /** github.com, or a fixture server in local tests. */
  GITHUB_WEB: string;
  GITHUB_RAW: string;
  /** api.github.com, or a fixture server in local tests. */
  GITHUB_API: string;
  /** The GitHub App (gizlet-bot) that reads repositories it is installed on, private ones included. Off without both. */
  GITHUB_APP_CLIENT_ID?: string;
  /** Its private key, PEM (PKCS#1 as GitHub issues it, or PKCS#8); a literal `\n` stands for a newline. */
  GITHUB_APP_PRIVATE_KEY?: string;
  /** The app's slug, for its install link. */
  GITHUB_APP_SLUG: string;
  /** A viewed gizlet is checked for a new release at most this often. */
  REFRESH_AFTER_SECONDS: string;
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
  /** Override for the issuer's JWKS URL (local tests only). */
  OIDC_JWKS_URL?: string;
  KEEP_MIRRORED_RELEASES: string;
  /** "1" lets the X-Gizlet-Host header pick the host (local tests only). */
  DEV_HOST_OVERRIDE: string;

  /** Bearer token for /v1/admin. */
  ADMIN_TOKEN?: string;
  /** Signs and encrypts Better Auth cookies and tokens. */
  BETTER_AUTH_SECRET: string;
  /** GitHub OAuth app; GitHub sign-in is off without it. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Account emails (Cloudflare Email Sending), from MAIL_FROM. Local runs log them instead. */
  MAIL?: SendEmail;
  MAIL_FROM: string;
  /** Domains links in our emails may use (src/auth.ts); set at deploy from the SITE_DOMAINS GitHub variable. */
  SITE_DOMAINS?: string;
}

export interface MirrorJob {
  repo: string;
  tag: string;
  /** The release revision the job was queued for; jobs for older revisions do nothing. */
  revision: number;
}

/** The part of ExecutionContext the Worker uses (Hono's and workers-types' differ). */
export interface Waiter {
  waitUntil(promise: Promise<unknown>): void;
}

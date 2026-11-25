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
  /** Postmark server token; without it, account emails are only logged. */
  POSTMARK_TOKEN?: string;
  MAIL_FROM: string;
}

export interface MirrorJob {
  repo: string;
  tag: string;
}

/** The part of ExecutionContext the Worker uses (Hono's and workers-types' differ). */
export interface Waiter {
  waitUntil(promise: Promise<unknown>): void;
}

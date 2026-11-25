import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "./env";

export interface ActionsClaims extends JWTPayload {
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_visibility?: string;
  ref: string;
  event_name?: string;
  workflow_ref?: string;
}

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

function keySet(env: Env) {
  const url = env.OIDC_JWKS_URL || `${env.OIDC_ISSUER}/.well-known/jwks`;
  if (jwks?.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url), { cacheMaxAge: 60 * 60 * 1000 }) };
  return jwks.set;
}

export class AuthError extends Error {}

/** Verify a GitHub Actions OIDC token for the store audience. */
export async function verifyActionsToken(env: Env, token: string): Promise<ActionsClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keySet(env), {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch (e) {
    throw new AuthError(`invalid GitHub Actions token: ${e instanceof Error ? e.message : String(e)}`);
  }
  const c = payload as ActionsClaims;
  if (typeof c.repository !== "string" || !c.repository.includes("/") || typeof c.repository_id !== "string") {
    throw new AuthError("token has no repository claim");
  }
  if (c.repository_visibility && c.repository_visibility !== "public") {
    throw new AuthError("only public repositories can publish");
  }
  return c;
}

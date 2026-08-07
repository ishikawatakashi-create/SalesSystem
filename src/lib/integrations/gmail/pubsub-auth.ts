import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  gmailPubSubAudience,
  gmailPubSubServiceAccount,
} from "@/lib/integrations/gmail/env";

export { parsePubSubPushBody } from "@/lib/integrations/gmail/pubsub-envelope";

const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export type PubSubAuthResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/**
 * Pub/Sub authenticated push の OIDC JWT を検証。
 * Authorization ヘッダの JWT 自体はログしない。
 */
export async function verifyPubSubPushJwt(
  authorizationHeader: string | null,
): Promise<PubSubAuthResult> {
  const audience = gmailPubSubAudience();
  const expectedSa = gmailPubSubServiceAccount();
  if (!audience || !expectedSa) {
    return { ok: false, reason: "env_missing" };
  }
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer" };
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, reason: "missing_bearer" };

  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience,
    });
    const iss = String(payload.iss ?? "");
    if (!GOOGLE_ISSUERS.has(iss)) {
      return { ok: false, reason: "bad_issuer" };
    }
    if (payload.email_verified !== true && payload.email_verified !== "true") {
      return { ok: false, reason: "email_unverified" };
    }
    const email = String(payload.email ?? "");
    if (!email || email.toLowerCase() !== expectedSa.toLowerCase()) {
      return { ok: false, reason: "bad_service_account" };
    }
    return { ok: true, email };
  } catch {
    return { ok: false, reason: "invalid_jwt" };
  }
}

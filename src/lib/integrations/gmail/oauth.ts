import "server-only";

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gmailOAuthClientId,
  gmailOAuthClientSecret,
  gmailOAuthRedirectUri,
} from "@/lib/integrations/gmail/env";
import { storeGmailRefreshToken } from "@/lib/integrations/gmail/tokens";
import {
  maskEmailAddress,
  patchGmailSettings,
} from "@/lib/integrations/gmail/settings";
import { gmailFetchJson } from "@/lib/integrations/gmail/client";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export function buildGmailAuthorizeUrl(state: string): string {
  const clientId = gmailOAuthClientId();
  const redirectUri = gmailOAuthRedirectUri();
  if (!clientId || !redirectUri) {
    throw new Error("gmail_oauth_env_missing");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function createOAuthState(userId: string): Promise<string> {
  const state = randomBytes(24).toString("hex");
  const admin = createAdminClient();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await admin.from("gmail_oauth_states").insert({
    state,
    created_by: userId,
    expires_at: expires,
  });
  if (error) throw new Error("oauth state create failed");
  return state;
}

export async function consumeOAuthState(state: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gmail_oauth_states")
    .select("created_by,expires_at")
    .eq("state", state)
    .maybeSingle();
  if (error || !data) return null;
  await admin.from("gmail_oauth_states").delete().eq("state", state);
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.created_by as string;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string | null;
  accessToken: string;
}> {
  const clientId = gmailOAuthClientId();
  const clientSecret = gmailOAuthClientSecret();
  const redirectUri = gmailOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("gmail_oauth_env_missing");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error("gmail_oauth_exchange_failed");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
  };
}

export async function completeGmailOAuth(input: {
  code: string;
  state: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await consumeOAuthState(input.state);
  if (!userId) return { ok: false, reason: "invalid_state" };

  const tokens = await exchangeCodeForTokens(input.code);
  if (!tokens.refreshToken) {
    // 既存同意済みで refresh が返らない場合は再 consent が必要
    return { ok: false, reason: "missing_refresh_token" };
  }
  await storeGmailRefreshToken(tokens.refreshToken);

  const profile = await gmailFetchJson<{ emailAddress?: string }>(
    "/gmail/v1/users/me/profile",
    tokens.accessToken,
  );
  const email = profile.emailAddress?.trim();
  await patchGmailSettings({
    status: "connected",
    needs_reconnect: false,
    email_masked: email ? maskEmailAddress(email) : undefined,
    ingestion_enabled: false,
    last_error_code: null,
  });
  return { ok: true };
}

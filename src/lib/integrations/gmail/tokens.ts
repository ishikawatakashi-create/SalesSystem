import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gmailOAuthClientId,
  gmailOAuthClientSecret,
} from "@/lib/integrations/gmail/env";
import { patchGmailSettings } from "@/lib/integrations/gmail/settings";

/** refresh token を Vault へ保存（平文はログしない） */
export async function storeGmailRefreshToken(token: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("store_gmail_oauth_refresh_token", {
    p_token: token,
  });
  if (error) throw new Error("gmail token store failed");
}

export async function readGmailRefreshToken(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("read_gmail_oauth_refresh_token");
  if (error) throw new Error("gmail token read failed");
  if (typeof data !== "string" || !data.trim()) return null;
  return data;
}

export async function clearGmailRefreshToken(): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("clear_gmail_oauth_refresh_token");
  if (error) throw new Error("gmail token clear failed");
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
};

/**
 * 必要時のみ access token を取得（長期平文保存しない）。
 * refresh 失敗時は needs_reconnect を立てる。
 */
export async function getGmailAccessToken(): Promise<string> {
  const clientId = gmailOAuthClientId();
  const clientSecret = gmailOAuthClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("gmail_oauth_env_missing");
  }
  const refresh = await readGmailRefreshToken();
  if (!refresh) {
    await patchGmailSettings({
      status: "needs_reconnect",
      needs_reconnect: true,
      last_error_code: "missing_refresh_token",
      last_error_at: new Date().toISOString(),
    });
    throw new Error("gmail_reconnect_required");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    await patchGmailSettings({
      status: "needs_reconnect",
      needs_reconnect: true,
      last_error_code: "refresh_invalid",
      last_error_at: new Date().toISOString(),
      ingestion_enabled: false,
    });
    throw new Error("gmail_reconnect_required");
  }
  return json.access_token;
}

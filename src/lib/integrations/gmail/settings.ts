import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { GmailIntegrationSettings } from "@/lib/inquiries/types";

export const GMAIL_SETTINGS_KEY = "gmail_integration";

export async function getGmailSettings(): Promise<GmailIntegrationSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", GMAIL_SETTINGS_KEY)
    .maybeSingle();
  if (error) throw new Error("gmail settings read failed");
  return (data?.value ?? {}) as GmailIntegrationSettings;
}

export async function patchGmailSettings(
  patch: GmailIntegrationSettings,
): Promise<GmailIntegrationSettings> {
  const admin = createAdminClient();
  const current = await getGmailSettings();
  const next = { ...current, ...patch };
  const { error } = await admin.from("system_settings").upsert({
    key: GMAIL_SETTINGS_KEY,
    value: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("gmail settings write failed");
  return next;
}

/** 表示用にメールをマスク（ローカル部先頭1文字のみ） */
export function maskEmailAddress(email: string): string {
  const parts = email.split("@");
  const local = parts[0] ?? "";
  const domain = parts[1];
  if (!domain) return "***";
  const head = local.slice(0, 1) || "*";
  return `${head}***@${domain}`;
}

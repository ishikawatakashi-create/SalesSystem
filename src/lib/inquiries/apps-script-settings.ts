import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export { heartbeatHealth } from "@/lib/inquiries/apps-script-health";

export const INQUIRY_APPS_SCRIPT_SETTINGS_KEY = "inquiry_apps_script";

export type InquiryAppsScriptSettings = {
  integration_mode?: "apps_script_polling";
  last_heartbeat_at?: string | null;
  last_ingest_at?: string | null;
  last_accepted_at?: string | null;
  last_duplicate_at?: string | null;
  last_error_code?: string | null;
  last_error_at?: string | null;
  ingest_count_24h?: number;
  /** deprecated Pub/Sub metadata は触らない（別キー gmail_integration） */
};

export async function getInquiryAppsScriptSettings(): Promise<InquiryAppsScriptSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", INQUIRY_APPS_SCRIPT_SETTINGS_KEY)
    .maybeSingle();
  if (error) throw new Error("inquiry apps script settings read failed");
  return (data?.value ?? {
    integration_mode: "apps_script_polling",
  }) as InquiryAppsScriptSettings;
}

export async function patchInquiryAppsScriptSettings(
  patch: InquiryAppsScriptSettings,
): Promise<InquiryAppsScriptSettings> {
  const admin = createAdminClient();
  const current = await getInquiryAppsScriptSettings();
  const next: InquiryAppsScriptSettings = {
    ...current,
    ...patch,
    integration_mode: "apps_script_polling",
  };
  const { error } = await admin.from("system_settings").upsert({
    key: INQUIRY_APPS_SCRIPT_SETTINGS_KEY,
    value: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("inquiry apps script settings write failed");
  return next;
}

export async function countInquiriesReceivedSince(
  sinceIso: string,
): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sinceIso);
  return count ?? 0;
}

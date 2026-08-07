import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type NotionWebhookSetupStatus = "awaiting" | "received" | "verified";

const SETUP_KEY = "notion_webhook_setup";

/**
 * verification_token を Vault へ保存(平文は system_settings に置かない)。
 * トークンはログしない。
 */
export async function storeVerificationToken(
  token: string,
): Promise<{ status: "received" }> {
  const admin = createAdminClient();
  const { error } = await admin.rpc(
    "store_notion_webhook_verification_token",
    { p_token: token },
  );
  if (error) {
    throw new Error("verification token store failed");
  }
  return { status: "received" };
}

/** system_settings のメタデータのみ返す(トークンなし) */
export async function getSetupStatus(): Promise<NotionWebhookSetupStatus> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SETUP_KEY)
    .maybeSingle();
  if (error) {
    throw new Error("webhook setup status read failed");
  }
  const status = (data?.value as { status?: string } | null)?.status;
  if (status === "received" || status === "verified") return status;
  return "awaiting";
}

/**
 * admin UI 等からのみ呼ぶ。平文トークンを返す。
 * 呼び出し側はログ・レスポンスへの平文露出を禁止。
 */
export async function revealVerificationToken(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "read_notion_webhook_verification_token",
  );
  if (error) {
    throw new Error("verification token reveal failed");
  }
  if (typeof data !== "string" || !data.trim()) return null;
  return data;
}

export async function markVerified(): Promise<{ status: "verified" }> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("mark_notion_webhook_verified");
  if (error) {
    throw new Error("mark verified failed");
  }
  return { status: "verified" };
}

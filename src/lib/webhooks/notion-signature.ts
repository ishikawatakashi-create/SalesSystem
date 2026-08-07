import "server-only";

import { verifyWebhookSignature } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Notion Webhook 署名検証用トークン解決。
 * NOTION_WEBHOOK_SECRET があれば優先。なければ Vault RPC から読む。
 * トークン自体は絶対にログしない。
 */
export async function getNotionWebhookVerificationToken(): Promise<
  string | null
> {
  const fromEnv = process.env.NOTION_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "read_notion_webhook_verification_token",
  );
  if (error) {
    throw new Error("verification token read failed");
  }
  if (typeof data !== "string" || !data.trim()) return null;
  return data;
}

/**
 * X-Notion-Signature を raw body で検証する。
 * トークン・署名・body はログしない。
 */
export async function verifyNotionWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
}): Promise<boolean> {
  const token = await getNotionWebhookVerificationToken();
  if (!token) return false;
  return verifyWebhookSignature({
    body: input.rawBody,
    signature: input.signatureHeader,
    verificationToken: token,
  });
}

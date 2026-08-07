import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  parsePubSubPushBody,
  verifyPubSubPushJwt,
} from "@/lib/integrations/gmail/pubsub-auth";
import { patchGmailSettings } from "@/lib/integrations/gmail/settings";

export type HandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

export function methodNotAllowed(): HandlerResult {
  return { status: 405, body: { error: "method_not_allowed" } };
}

/**
 * Pub/Sub push: 認証 → durable ingest → 2xx。
 * request 中に Gmail messages.get はしない。
 */
export async function handleGmailPubSubPost(
  request: Request,
): Promise<HandlerResult> {
  const auth = await verifyPubSubPushJwt(
    request.headers.get("authorization"),
  );
  if (!auth.ok) {
    return { status: 401, body: { error: "unauthorized" } };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  const parsed = parsePubSubPushBody(raw);
  if (!parsed.ok) {
    return { status: 400, body: { error: "malformed" } };
  }

  const admin = createAdminClient();
  const eventId = `gmail:${parsed.messageId}`;

  try {
    const { data: jobId, error } = await admin.rpc("ingest_gmail_pubsub_event", {
      p_event_id: eventId,
      p_email_address: parsed.emailAddress,
      p_history_id: parsed.historyId,
      p_payload: {
        // メール本文・アドレス全文は保存しない
        history_id: parsed.historyId,
      },
    });
    if (error) {
      await admin.from("sync_errors").insert({
        stage: "gmail.pubsub.ingest",
        entity_type: "gmail",
        notion_page_id: null,
        external_id: null,
        message: "Gmail Pub/Sub の取り込みに失敗しました",
        detail: { code: "ingest_failed" },
      });
      return { status: 500, body: { error: "ingest_failed" } };
    }

    await patchGmailSettings({
      last_notification_at: new Date().toISOString(),
    });

    return { status: 204, body: { ok: true, job_id: jobId } };
  } catch {
    return { status: 500, body: { error: "internal" } };
  }
}

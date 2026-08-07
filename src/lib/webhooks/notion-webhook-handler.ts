import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyNotionWebhookSignature } from "@/lib/webhooks/notion-signature";
import { storeVerificationToken } from "@/lib/webhooks/verification-store";

export type NotionWebhookHandleResult = {
  status: number;
  body: Record<string, unknown>;
};

function isVerificationHandshake(payload: Record<string, unknown>): boolean {
  const token = payload.verification_token;
  if (typeof token !== "string" || !token.trim()) return false;
  // 通常イベントは id + type を持つ。handshake は verification_token のみ。
  const hasEventId = typeof payload.id === "string" && payload.id.length > 0;
  const hasEventType =
    typeof payload.type === "string" && payload.type.length > 0;
  return !hasEventId && !hasEventType;
}

/**
 * Notion Webhook POST 本体。route とテストから共有。
 * シークレット・トークン・署名・payload はログしない。
 */
export async function handleNotionWebhookPost(
  request: Request,
): Promise<NotionWebhookHandleResult> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: 400, body: { ok: false, error: "invalid_json" } };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }

  try {
    if (isVerificationHandshake(payload)) {
      const token = String(payload.verification_token);
      await storeVerificationToken(token);
      return { status: 200, body: { ok: true } };
    }

    const signatureHeader = request.headers.get("x-notion-signature");
    const signed = await verifyNotionWebhookSignature({
      rawBody,
      signatureHeader,
    });
    if (!signed) {
      return { status: 401, body: { ok: false, error: "invalid_signature" } };
    }

    const eventId = payload.id;
    const eventType = payload.type;
    if (typeof eventId !== "string" || !eventId) {
      return { status: 400, body: { ok: false, error: "missing_event_id" } };
    }
    if (typeof eventType !== "string" || !eventType) {
      return { status: 400, body: { ok: false, error: "missing_event_type" } };
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc("ingest_webhook_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payload: payload,
    });
    if (error) {
      return { status: 500, body: { ok: false, error: "ingest_failed" } };
    }

    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 500, body: { ok: false, error: "internal_error" } };
  }
}

export function methodNotAllowed(): NotionWebhookHandleResult {
  return { status: 405, body: { ok: false, error: "method_not_allowed" } };
}

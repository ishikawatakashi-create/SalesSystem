export type PubSubPushBody = {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
    publish_time?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
};

export type GmailNotifyPayload = {
  emailAddress?: string;
  historyId?: number | string;
};

export function parsePubSubPushBody(raw: unknown): {
  ok: true;
  messageId: string;
  historyId: string;
  emailAddress: string | null;
} | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const body = raw as PubSubPushBody;
  const msg = body.message;
  if (!msg?.data) return { ok: false, reason: "missing_data" };
  const messageId = msg.messageId || msg.message_id;
  if (!messageId) return { ok: false, reason: "missing_message_id" };

  let decoded: GmailNotifyPayload;
  try {
    const json = Buffer.from(msg.data, "base64").toString("utf8");
    decoded = JSON.parse(json) as GmailNotifyPayload;
  } catch {
    return { ok: false, reason: "bad_data_encoding" };
  }
  const historyId =
    decoded.historyId !== undefined && decoded.historyId !== null
      ? String(decoded.historyId)
      : "";
  if (!historyId) return { ok: false, reason: "missing_history_id" };

  return {
    ok: true,
    messageId: String(messageId),
    historyId,
    emailAddress: decoded.emailAddress?.trim() || null,
  };
}

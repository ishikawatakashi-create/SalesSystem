import "server-only";

import {
  extractMailContent,
  getGmailMessage,
  gmailFetchJson,
} from "@/lib/integrations/gmail/client";
import {
  getGmailSettings,
  patchGmailSettings,
} from "@/lib/integrations/gmail/settings";
import { ingestInquiryFromMail } from "@/lib/inquiries/ingest";

type ListMessagesResponse = {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
};

/**
 * label 付きメッセージを一定期間だけ再走査（full mailbox 禁止）。
 */
export async function reconcileGmailLabelMessages(input?: {
  days?: number;
  maxMessages?: number;
}): Promise<{ processed: number; created: number }> {
  const settings = await getGmailSettings();
  if (!settings.label_id || !settings.ingestion_enabled) {
    return { processed: 0, created: 0 };
  }

  const days = input?.days ?? 7;
  const maxMessages = input?.maxMessages ?? 100;
  const after = Math.floor((Date.now() - days * 86400000) / 1000);

  // label id での list: labelIds パラメータを使う
  let pageToken: string | undefined;
  let processed = 0;
  let created = 0;
  let fetched = 0;
  let maxHistoryId: bigint | null = settings.last_history_id
    ? BigInt(settings.last_history_id)
    : null;

  do {
    const params = new URLSearchParams({
      maxResults: "50",
      q: `after:${after}`,
    });
    params.append("labelIds", settings.label_id);
    if (pageToken) params.set("pageToken", pageToken);

    const data = await gmailFetchJson<ListMessagesResponse>(
      `/gmail/v1/users/me/messages?${params.toString()}`,
    );

    for (const m of data.messages ?? []) {
      if (!m.id) continue;
      if (fetched >= maxMessages) break;
      fetched += 1;
      const message = await getGmailMessage(m.id);
      const content = extractMailContent(message);
      const result = await ingestInquiryFromMail({
        sourceMessageId: message.id,
        sourceThreadId: message.threadId ?? null,
        receivedAt: content.receivedAt,
        subject: content.subject,
        from: content.from,
        replyTo: content.replyTo,
        plainText: content.plainText,
        htmlText: content.htmlText,
        attachments: content.attachments,
      });
      processed += 1;
      if (result.created) created += 1;
    }

    pageToken = data.nextPageToken;
    if (fetched >= maxMessages) break;
  } while (pageToken);

  // profile の historyId を取得して watermark 更新
  try {
    const profile = await gmailFetchJson<{ historyId?: string }>(
      "/gmail/v1/users/me/profile",
    );
    if (profile.historyId) {
      const hid = BigInt(profile.historyId);
      if (maxHistoryId === null || hid > maxHistoryId) maxHistoryId = hid;
    }
  } catch {
    // ignore
  }

  await patchGmailSettings({
    last_history_id: maxHistoryId ? String(maxHistoryId) : settings.last_history_id,
    last_reconciliation_at: new Date().toISOString(),
    last_history_sync_at: new Date().toISOString(),
  });

  return { processed, created };
}

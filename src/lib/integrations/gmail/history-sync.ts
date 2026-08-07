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
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileGmailLabelMessages } from "@/lib/integrations/gmail/reconciliation";

type HistoryListResponse = {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: { id?: string; labelIds?: string[] } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

function isHistoryInvalidError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("gmail_api_404") ||
    msg.includes("gmail_api_400") ||
    msg.toLowerCase().includes("historyid")
  );
}

/**
 * history.list 差分同期。label 未設定なら何もしない。
 */
export async function syncGmailHistory(input?: {
  notifyHistoryId?: string | null;
}): Promise<{
  processed: number;
  created: number;
  skipped: boolean;
  reconciled?: boolean;
}> {
  const settings = await getGmailSettings();
  if (
    settings.status !== "connected" ||
    !settings.ingestion_enabled ||
    !settings.label_id
  ) {
    return { processed: 0, created: 0, skipped: true };
  }

  const startHistoryId = settings.last_history_id || settings.history_id;
  if (!startHistoryId) {
    const r = await reconcileGmailLabelMessages({ days: 7 });
    return {
      processed: r.processed,
      created: r.created,
      skipped: false,
      reconciled: true,
    };
  }

  const labelId = settings.label_id;
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  let processed = 0;
  let created = 0;
  const seenMessages = new Set<string>();

  try {
    do {
      const params = new URLSearchParams({
        startHistoryId: startHistoryId,
        historyTypes: "messageAdded",
      });
      // labelId で絞り込み（API がサポート）
      params.append("labelId", labelId);
      if (pageToken) params.set("pageToken", pageToken);

      const data = await gmailFetchJson<HistoryListResponse>(
        `/gmail/v1/users/me/history?${params.toString()}`,
      );

      for (const h of data.history ?? []) {
        if (h.id) latestHistoryId = String(h.id);
        for (const added of h.messagesAdded ?? []) {
          const mid = added.message?.id;
          if (!mid || seenMessages.has(mid)) continue;
          seenMessages.add(mid);
          const labels = added.message?.labelIds ?? [];
          if (labels.length > 0 && !labels.includes(labelId)) continue;

          const message = await getGmailMessage(mid);
          if (message.labelIds && !message.labelIds.includes(labelId)) {
            continue;
          }
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
      }
      pageToken = data.nextPageToken;
      if (data.historyId) latestHistoryId = String(data.historyId);
    } while (pageToken);

    // notify の historyId が新しい場合も watermark を前進
    if (
      input?.notifyHistoryId &&
      BigInt(input.notifyHistoryId) > BigInt(latestHistoryId)
    ) {
      latestHistoryId = input.notifyHistoryId;
    }

    await patchGmailSettings({
      last_history_id: latestHistoryId,
      last_history_sync_at: new Date().toISOString(),
      last_notification_at: input?.notifyHistoryId
        ? new Date().toISOString()
        : settings.last_notification_at,
      last_error_code: null,
    });

    return { processed, created, skipped: false };
  } catch (e) {
    if (isHistoryInvalidError(e)) {
      const r = await reconcileGmailLabelMessages({ days: 14 });
      await patchGmailSettings({
        last_error_code: "history_invalid_reconciled",
        last_error_at: new Date().toISOString(),
      });
      const admin = createAdminClient();
      await admin.from("sync_errors").insert({
        stage: "gmail.history.invalid",
        entity_type: "gmail",
        notion_page_id: null,
        external_id: null,
        message: "historyId が無効のため reconciliation を実行しました",
        detail: { created: r.created, processed: r.processed },
      });
      return {
        processed: r.processed,
        created: r.created,
        skipped: false,
        reconciled: true,
      };
    }
    throw e;
  }
}

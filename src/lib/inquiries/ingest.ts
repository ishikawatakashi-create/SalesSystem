import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  looksLikeStrikinglyNotification,
  parseStrikinglyNotificationMail,
} from "@/lib/inquiries/parser-strikingly";
import { normalizePhone } from "@/lib/normalize/phone";
import type { InquiryAttachmentMeta, InquiryRow } from "@/lib/inquiries/types";

export type IngestMailInput = {
  sourceMessageId: string;
  sourceThreadId: string | null;
  receivedAt: string;
  subject: string | null;
  from: string | null;
  replyTo: string | null;
  plainText: string | null;
  htmlText: string | null;
  attachments?: InquiryAttachmentMeta[];
  /** true: 過去 backfill。badge 対象外。自動顧客化はしない（ingest は常に受信箱のみ） */
  historicalImport?: boolean;
  /**
   * true（既定）: Strikingly と確定できないメールは insert しない。
   * 通常 polling / backfill 双方で label 混在メールを取りこぼしなくスキップする。
   */
  requireStrikingly?: boolean;
};

export type IngestMailResult =
  | { status: "accepted"; inquiry: InquiryRow }
  | { status: "duplicate"; inquiry: InquiryRow }
  | { status: "skipped"; reason: string };

/**
 * Gmail message → inquiries へ upsert（source_message_id unique）。
 * 本文はログしない。顧客/Contact/Activity/Notion へは自動投入しない。
 */
export async function ingestInquiryFromMail(
  input: IngestMailInput,
): Promise<IngestMailResult> {
  const parsed = parseStrikinglyNotificationMail({
    subject: input.subject,
    from: input.from,
    replyTo: input.replyTo,
    plainText: input.plainText,
    htmlText: input.htmlText,
  });

  const requireStrikingly = input.requireStrikingly !== false;
  if (requireStrikingly) {
    const strikinglyLike = looksLikeStrikinglyNotification({
      subject: input.subject,
      from: input.from,
      body: input.plainText || input.htmlText || parsed.messageText,
    });
    if (!strikinglyLike) {
      return { status: "skipped", reason: "not_strikingly" };
    }
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("inquiries")
    .select("*")
    .eq("source_message_id", input.sourceMessageId)
    .maybeSingle();
  if (existing) {
    return { status: "duplicate", inquiry: existing as InquiryRow };
  }

  const historicalImport = Boolean(input.historicalImport);
  const row = {
    source: "strikingly_email",
    source_message_id: input.sourceMessageId,
    source_thread_id: input.sourceThreadId,
    // 元メール受信日時（backfill 実行日時ではない）
    received_at: input.receivedAt,
    subject: parsed.subject,
    sender_name: parsed.senderName,
    sender_email: parsed.senderEmail,
    reply_to_email: parsed.replyToEmail,
    phone: parsed.phone,
    phone_normalized: normalizePhone(parsed.phone),
    company_name: parsed.companyName,
    form_name: parsed.formName,
    message_text: parsed.messageText,
    form_fields: parsed.formFields,
    attachment_meta: input.attachments ?? [],
    status: "new" as const,
    parse_status: parsed.parseStatus,
    parse_warning_code: parsed.parseWarningCode,
    source_confidence: parsed.sourceConfidence,
    historical_import: historicalImport,
  };

  const { data, error } = await admin
    .from("inquiries")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await admin
        .from("inquiries")
        .select("*")
        .eq("source_message_id", input.sourceMessageId)
        .maybeSingle();
      if (again) {
        return { status: "duplicate", inquiry: again as InquiryRow };
      }
    }
    throw new Error("inquiry_insert_failed");
  }

  await admin.from("audit_logs").insert({
    action: "inquiry.received",
    entity_type: "inquiry",
    notion_page_id: null,
    actor_id: null,
    actor_name: "system",
    changed_fields: {
      inquiry_id: data.id,
      status: "new",
      parse_status: parsed.parseStatus,
      source: "strikingly_email",
      historical_import: historicalImport,
      // 本文は入れない
    },
    operation_source: historicalImport
      ? "apps_script_backfill"
      : "apps_script_ingest",
    request_id: null,
    batch_id: null,
  });

  return { status: "accepted", inquiry: data as InquiryRow };
}

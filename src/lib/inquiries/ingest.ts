import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseStrikinglyNotificationMail } from "@/lib/inquiries/parser-strikingly";
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
};

/**
 * Gmail message → inquiries へ upsert（source_message_id unique）。
 * 本文はログしない。
 */
export async function ingestInquiryFromMail(
  input: IngestMailInput,
): Promise<{ inquiry: InquiryRow; created: boolean }> {
  const parsed = parseStrikinglyNotificationMail({
    subject: input.subject,
    from: input.from,
    replyTo: input.replyTo,
    plainText: input.plainText,
    htmlText: input.htmlText,
  });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("inquiries")
    .select("*")
    .eq("source_message_id", input.sourceMessageId)
    .maybeSingle();
  if (existing) {
    return { inquiry: existing as InquiryRow, created: false };
  }

  const row = {
    source: "strikingly_email",
    source_message_id: input.sourceMessageId,
    source_thread_id: input.sourceThreadId,
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
      if (again) return { inquiry: again as InquiryRow, created: false };
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
      // 本文は入れない
    },
    operation_source: "gmail_ingest",
    request_id: null,
    batch_id: null,
  });

  return { inquiry: data as InquiryRow, created: true };
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isReplyOrForwardSubject,
  isStrikinglySourceNotification,
  parseStrikinglyNotificationMail,
  selectParseBody,
  STRIKINGLY_PARSER_VERSION,
} from "@/lib/inquiries/parser-strikingly";
import { htmlToPlainText } from "@/lib/inquiries/html-text";
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
  historicalImport?: boolean;
  requireStrikingly?: boolean;
};

export type IngestMailResult =
  | { status: "accepted"; inquiry: InquiryRow }
  | { status: "updated"; inquiry: InquiryRow }
  | { status: "duplicate"; inquiry: InquiryRow }
  | { status: "skipped"; reason: string };

function bodyForGate(input: IngestMailInput): string {
  const plain = (input.plainText ?? "").trim();
  const fromHtml = input.htmlText ? htmlToPlainText(input.htmlText) : "";
  return selectParseBody(plain, fromHtml);
}

function sourceDerivedRow(
  parsed: ReturnType<typeof parseStrikinglyNotificationMail>,
) {
  return {
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
    parse_status: parsed.parseStatus,
    parse_warning_code: parsed.parseWarningCode,
    source_confidence: parsed.sourceConfidence,
    parser_version: parsed.parserVersion,
    ingest_classification: "source" as const,
  };
}

/**
 * Gmail message → inquiries へ upsert（source_message_id unique）。
 * 本文・HTML はログしない。HTML は永続保存しない。
 */
export async function ingestInquiryFromMail(
  input: IngestMailInput,
): Promise<IngestMailResult> {
  const gateBody = bodyForGate(input);
  const requireStrikingly = input.requireStrikingly !== false;
  const isSource =
    !isReplyOrForwardSubject(input.subject) &&
    isStrikinglySourceNotification({
      subject: input.subject,
      from: input.from,
      body: gateBody,
    });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("inquiries")
    .select("*")
    .eq("source_message_id", input.sourceMessageId)
    .maybeSingle();

  if (requireStrikingly && !isSource) {
    const reason = isReplyOrForwardSubject(input.subject)
      ? "reply_or_forward"
      : "not_strikingly";
    // 既に誤取込済みなら一覧除外マーク（物理削除しない）
    if (
      existing &&
      (existing as InquiryRow).ingest_classification !== "ignored_non_source"
    ) {
      await admin
        .from("inquiries")
        .update({
          ingest_classification: "ignored_non_source",
          updated_at: new Date().toISOString(),
        })
        .eq("id", (existing as InquiryRow).id);
    }
    return { status: "skipped", reason };
  }

  const parsed = parseStrikinglyNotificationMail({
    subject: input.subject,
    from: input.from,
    replyTo: input.replyTo,
    plainText: input.plainText,
    htmlText: input.htmlText,
  });

  if (existing) {
    const row = existing as InquiryRow;
    const existingVersion = row.parser_version ?? 1;
    if (
      existingVersion >= STRIKINGLY_PARSER_VERSION &&
      row.ingest_classification === "source"
    ) {
      return { status: "duplicate", inquiry: row };
    }

    const derived = sourceDerivedRow(parsed);
    const { data: updated, error } = await admin
      .from("inquiries")
      .update({
        ...derived,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();

    if (error || !updated) {
      throw new Error("inquiry_update_failed");
    }

    await admin.from("audit_logs").insert({
      action: "inquiry.reparsed",
      entity_type: "inquiry",
      notion_page_id: null,
      actor_id: null,
      actor_name: "system",
      changed_fields: {
        inquiry_id: updated.id,
        parser_version: STRIKINGLY_PARSER_VERSION,
        // 本文は入れない
      },
      operation_source: "apps_script_ingest",
      request_id: null,
      batch_id: null,
    });

    return { status: "updated", inquiry: updated as InquiryRow };
  }

  const historicalImport = Boolean(input.historicalImport);
  const derived = sourceDerivedRow(parsed);
  const insertRow = {
    source: "strikingly_email",
    source_message_id: input.sourceMessageId,
    source_thread_id: input.sourceThreadId,
    received_at: input.receivedAt,
    ...derived,
    attachment_meta: input.attachments ?? [],
    status: "new" as const,
    historical_import: historicalImport,
  };

  const { data, error } = await admin
    .from("inquiries")
    .insert(insertRow)
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
      parser_version: STRIKINGLY_PARSER_VERSION,
    },
    operation_source: historicalImport
      ? "apps_script_backfill"
      : "apps_script_ingest",
    request_id: null,
    batch_id: null,
  });

  return { status: "accepted", inquiry: data as InquiryRow };
}

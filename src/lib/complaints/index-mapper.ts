import type { ComplaintDomain } from "@/lib/notion/converters/complaint";
import type { ComplaintIndexRow } from "@/lib/complaints/types";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize";

function buildComplaintSearchText(source: {
  title: string;
  summary: string | null;
  note: string | null;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffName?: string | null;
}): string {
  const parts = [
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    source.summary
      ? removeAllWhitespace(toSearchLower(source.summary))
      : "",
    source.note ? removeAllWhitespace(toSearchLower(source.note)) : "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
    source.dealTitle
      ? removeAllWhitespace(toSearchLower(source.dealTitle))
      : "",
    source.staffName
      ? removeAllWhitespace(toSearchLower(source.staffName))
      : "",
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

export function complaintDomainToIndexRow(input: {
  complaint: ComplaintDomain;
  assigneeUserId: string | null;
  statusSemantic: string | null;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: ComplaintIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffName?: string | null;
  nowIso?: string;
}): Omit<ComplaintIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const c = input.complaint;

  return {
    notion_page_id: c.notionPageId,
    external_id: c.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    title: c.title,
    summary: c.summary,
    body_hash: c.bodyHash,
    customer_page_id: c.customerPageId,
    deal_page_id: c.dealPageId,
    occurred_on: c.occurredOn,
    severity_id: c.severityPageId,
    assignee_user_id: input.assigneeUserId,
    staff_page_id: c.staffPageId,
    due_date: c.dueDate,
    status_id: c.statusPageId,
    status_semantic: input.statusSemantic,
    completed_on: c.completedOn,
    note: c.note,
    search_text: buildComplaintSearchText({
      title: c.title,
      summary: c.summary,
      note: c.note,
      customerDisplayName: input.customerDisplayName,
      dealTitle: input.dealTitle,
      staffName: input.staffName,
    }),
  };
}

export const COMPLAINT_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "title", column: "title", note: "タイトル" },
  { domain: "summary", column: "summary", note: "概要" },
  { domain: "bodyHash", column: "body_hash", note: "本文はキャッシュしない" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  { domain: "dealPageId", column: "deal_page_id", note: "関連案件" },
  { domain: "occurredOn", column: "occurred_on", note: "" },
  { domain: "severityPageId", column: "severity_id", note: "クレーム重要度" },
  {
    domain: "staffPageId",
    column: "assignee_user_id",
    note: "app_users.id へ解決",
  },
  {
    domain: "staffPageId",
    column: "staff_page_id",
    note: "対応責任者 Notion page ID",
  },
  { domain: "dueDate", column: "due_date", note: "" },
  { domain: "statusPageId", column: "status_id", note: "クレーム対応状況" },
  {
    domain: "(masters_cache)",
    column: "status_semantic",
    note: "semantic_key",
  },
  { domain: "completedOn", column: "completed_on", note: "" },
  { domain: "note", column: "note", note: "" },
  { domain: "(computed)", column: "search_text", note: "" },
] as const;

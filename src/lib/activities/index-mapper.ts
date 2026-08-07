import type { ActivityDomain } from "@/lib/notion/converters/activity";
import type { ActivityIndexRow } from "@/lib/activities/types";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize";

function buildActivitySearchText(source: {
  title: string;
  summary: string | null;
  body: string;
  customerDisplayName?: string | null;
  contactNames?: string[];
  dealTitle?: string | null;
  categoryNames?: string[];
  createdByName?: string | null;
}): string {
  const parts = [
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    source.summary
      ? removeAllWhitespace(toSearchLower(source.summary))
      : "",
    source.body ? removeAllWhitespace(toSearchLower(source.body)) : "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
    source.dealTitle
      ? removeAllWhitespace(toSearchLower(source.dealTitle))
      : "",
    source.createdByName
      ? removeAllWhitespace(toSearchLower(source.createdByName))
      : "",
    ...(source.contactNames ?? []).map((n) =>
      n ? removeAllWhitespace(toSearchLower(n)) : "",
    ),
    ...(source.categoryNames ?? []).map((n) =>
      n ? removeAllWhitespace(toSearchLower(n)) : "",
    ),
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

export function activityDomainToIndexRow(input: {
  activity: ActivityDomain;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: ActivityIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  customerDisplayName?: string | null;
  contactNames?: string[];
  dealTitle?: string | null;
  categoryNames?: string[];
  nowIso?: string;
}): Omit<ActivityIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const a = input.activity;

  return {
    notion_page_id: a.notionPageId,
    external_id: a.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    title: a.title,
    summary: a.summary,
    body_hash: a.bodyHash,
    customer_page_id: a.customerPageId,
    deal_page_id: a.dealPageId,
    contact_page_ids: a.contactPageIds,
    activity_at: a.activityAt,
    category_ids: a.categoryPageIds,
    created_by: a.createdById,
    created_by_name: a.createdByName,
    updated_by: a.updatedById,
    updated_by_name: a.updatedByName,
    batch_id: a.batchId,
    search_text: buildActivitySearchText({
      title: a.title,
      summary: a.summary,
      body: a.body,
      customerDisplayName: input.customerDisplayName,
      contactNames: input.contactNames,
      dealTitle: input.dealTitle,
      categoryNames: input.categoryNames,
      createdByName: a.createdByName,
    }),
  };
}

export const ACTIVITY_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "title", column: "title", note: "タイトル" },
  { domain: "summary", column: "summary", note: "要約" },
  { domain: "bodyHash", column: "body_hash", note: "本文はキャッシュしない" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  { domain: "dealPageId", column: "deal_page_id", note: "関連案件・単一" },
  {
    domain: "contactPageIds",
    column: "contact_page_ids",
    note: "先方担当者",
  },
  { domain: "activityAt", column: "activity_at", note: "timestamptz" },
  {
    domain: "categoryPageIds",
    column: "category_ids",
    note: "対応履歴分類",
  },
  {
    domain: "createdById",
    column: "created_by",
    note: "登録者ID(staff relationではない)",
  },
  { domain: "createdByName", column: "created_by_name", note: "登録者名" },
  { domain: "updatedById", column: "updated_by", note: "最終編集者ID" },
  { domain: "updatedByName", column: "updated_by_name", note: "最終編集者名" },
  { domain: "batchId", column: "batch_id", note: "" },
  { domain: "(computed)", column: "search_text", note: "" },
  { domain: "(computed)", column: "content_hash", note: "本文hash含む" },
] as const;

import type { DealDomain } from "@/lib/notion/converters/deal";
import type { DealIndexRow } from "@/lib/deals/types";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize";

function buildDealSearchText(source: {
  title: string;
  productName: string | null;
  customerDisplayName?: string | null;
  contactNames?: string[];
  staffNames?: string[];
}): string {
  const parts = [
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    source.productName
      ? removeAllWhitespace(toSearchLower(source.productName))
      : "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
    ...(source.contactNames ?? []).map((n) =>
      n ? removeAllWhitespace(toSearchLower(n)) : "",
    ),
    ...(source.staffNames ?? []).map((n) =>
      n ? removeAllWhitespace(toSearchLower(n)) : "",
    ),
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

/**
 * Notionドメイン → deal_index upsert行。
 * staffPageIds は app_users.id へ解決済みの配列を渡す。
 * status_semantic は masters_cache から解決済みの値を渡す。
 */
export function dealDomainToIndexRow(input: {
  deal: DealDomain;
  staffUserIds: string[];
  statusSemantic: string | null;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: DealIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  customerDisplayName?: string | null;
  contactNames?: string[];
  staffNames?: string[];
  nowIso?: string;
}): Omit<DealIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const d = input.deal;

  return {
    notion_page_id: d.notionPageId,
    external_id: d.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    title: d.title,
    customer_page_id: d.customerPageId,
    contact_page_ids: d.contactPageIds,
    business_category_id: d.businessCategoryPageId,
    product_name: d.productName,
    stage_id: d.stagePageId,
    status_id: d.statusPageId,
    status_semantic: input.statusSemantic,
    staff_user_ids: input.staffUserIds,
    staff_page_ids: d.staffPageIds,
    expected_amount: d.expectedAmount,
    contract_amount: d.contractAmount,
    probability: d.probability,
    expected_close_date: d.expectedCloseDate,
    contracted_at: d.contractedAt,
    period_start: d.periodStart,
    period_end: d.periodEnd,
    next_action: d.nextAction,
    next_action_date: d.nextActionDate,
    lost_reason: d.lostReason,
    note: d.note,
    search_text: buildDealSearchText({
      title: d.title,
      productName: d.productName,
      customerDisplayName: input.customerDisplayName,
      contactNames: input.contactNames,
      staffNames: input.staffNames,
    }),
  };
}

export const DEAL_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "title", column: "title", note: "案件名" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  {
    domain: "contactPageIds",
    column: "contact_page_ids",
    note: "Notion page IDs",
  },
  {
    domain: "businessCategoryPageId",
    column: "business_category_id",
    note: "master page ID",
  },
  { domain: "productName", column: "product_name", note: "" },
  { domain: "stagePageId", column: "stage_id", note: "案件ステージ" },
  { domain: "statusPageId", column: "status_id", note: "案件ステータス" },
  {
    domain: "(masters_cache)",
    column: "status_semantic",
    note: "semantic_key",
  },
  {
    domain: "staffPageIds",
    column: "staff_user_ids",
    note: "app_users.id へ解決",
  },
  {
    domain: "staffPageIds",
    column: "staff_page_ids",
    note: "Notion page IDs",
  },
  { domain: "expectedAmount", column: "expected_amount", note: "" },
  { domain: "contractAmount", column: "contract_amount", note: "" },
  { domain: "probability", column: "probability", note: "" },
  { domain: "expectedCloseDate", column: "expected_close_date", note: "" },
  { domain: "contractedAt", column: "contracted_at", note: "" },
  { domain: "periodStart", column: "period_start", note: "" },
  { domain: "periodEnd", column: "period_end", note: "" },
  { domain: "nextAction", column: "next_action", note: "導出" },
  { domain: "nextActionDate", column: "next_action_date", note: "導出" },
  { domain: "lostReason", column: "lost_reason", note: "" },
  { domain: "note", column: "note", note: "" },
  { domain: "(computed)", column: "search_text", note: "" },
  { domain: "(computed)", column: "content_hash", note: "" },
  { domain: "lastEditedTime", column: "notion_last_edited_at", note: "" },
  { domain: "(pipeline)", column: "sync_status", note: "" },
] as const;

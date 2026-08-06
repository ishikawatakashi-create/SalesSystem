import type { CustomerDomain } from "@/lib/notion/converters/customer";
import type { CustomerIndexRow } from "@/lib/customers/types";
import {
  buildCustomerSearchText,
  buildCustomerSearchTextKana,
  normalizeEmailOrNull,
  normalizePhone,
} from "@/lib/normalize";

/**
 * Notionドメイン → customer_index upsert行。
 * staffPageIds は app_users.id へ解決済みの配列を渡す。
 * 関連アカウントは customer_relations 側で扱う(本行には含めない)。
 */
export function customerDomainToIndexRow(input: {
  customer: CustomerDomain;
  staffUserIds: string[];
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: CustomerIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  extraSearchTokens?: string[];
  nowIso?: string;
}): Omit<CustomerIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const searchSource = {
    displayName: input.customer.displayName,
    legalName: input.customer.legalName,
    officeName: input.customer.officeName,
    prefecture: input.customer.prefecture,
    city: input.customer.city,
    addressLine: input.customer.addressLine,
    phone: input.customer.phone,
    email: input.customer.email,
    representativeName: input.customer.representativeName,
    extraTokens: input.extraSearchTokens,
  };

  return {
    notion_page_id: input.customer.notionPageId,
    external_id: input.customer.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    display_name: input.customer.displayName,
    legal_name: input.customer.legalName,
    office_name: input.customer.officeName,
    postal_code: input.customer.postalCode,
    prefecture: input.customer.prefecture,
    city: input.customer.city,
    address_line: input.customer.addressLine,
    phone_normalized: normalizePhone(input.customer.phone),
    phone: input.customer.phone,
    email: normalizeEmailOrNull(input.customer.email),
    representative_name: input.customer.representativeName,
    website: input.customer.website,
    business_category_ids: input.customer.businessCategoryPageIds,
    tag_ids: input.customer.tagPageIds,
    sales_status_id: input.customer.salesStatusPageId,
    acquisition_route_id: input.customer.acquisitionRoutePageId,
    priority_id: input.customer.priorityPageId,
    staff_user_ids: input.staffUserIds,
    latest_activity_summary: input.customer.latestActivitySummary,
    last_activity_at: input.customer.lastActivityAt,
    next_action: input.customer.nextAction,
    next_action_date: input.customer.nextActionDate,
    expected_amount: input.customer.expectedAmount,
    is_archived: input.customer.isArchived,
    search_text: buildCustomerSearchText(searchSource),
    search_text_kana: buildCustomerSearchTextKana(searchSource),
  };
}

/**
 * customer_index 対応表(Notion/ドメイン → 列)。
 * 関連アカウントは customer_relations(from_page_id,to_page_id)。
 */
export const CUSTOMER_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "displayName", column: "display_name", note: "表示原文" },
  { domain: "legalName", column: "legal_name", note: "表示原文" },
  { domain: "officeName", column: "office_name", note: "表示原文" },
  { domain: "postalCode", column: "postal_code", note: "表示原文" },
  { domain: "prefecture", column: "prefecture", note: "" },
  { domain: "city", column: "city", note: "" },
  { domain: "addressLine", column: "address_line", note: "" },
  {
    domain: "phone",
    column: "phone",
    note: "表示原文",
  },
  {
    domain: "phone(normalized)",
    column: "phone_normalized",
    note: "数字のみ",
  },
  { domain: "email", column: "email", note: "lower/trim" },
  { domain: "representativeName", column: "representative_name", note: "" },
  { domain: "website", column: "website", note: "" },
  {
    domain: "businessCategoryPageIds",
    column: "business_category_ids",
    note: "master page IDs",
  },
  { domain: "tagPageIds", column: "tag_ids", note: "master page IDs" },
  {
    domain: "salesStatusPageId",
    column: "sales_status_id",
    note: "master page ID",
  },
  {
    domain: "acquisitionRoutePageId",
    column: "acquisition_route_id",
    note: "master page ID",
  },
  { domain: "priorityPageId", column: "priority_id", note: "master page ID" },
  {
    domain: "staffPageIds",
    column: "staff_user_ids",
    note: "app_users.id へ解決",
  },
  {
    domain: "relatedAccountPageIds",
    column: "customer_relations",
    note: "別テーブル",
  },
  {
    domain: "latestActivitySummary",
    column: "latest_activity_summary",
    note: "導出キャッシュ",
  },
  { domain: "lastActivityAt", column: "last_activity_at", note: "導出" },
  { domain: "nextAction", column: "next_action", note: "導出" },
  { domain: "nextActionDate", column: "next_action_date", note: "導出" },
  { domain: "expectedAmount", column: "expected_amount", note: "導出" },
  { domain: "isArchived", column: "is_archived", note: "" },
  { domain: "(computed)", column: "content_hash", note: "" },
  { domain: "lastEditedTime", column: "notion_last_edited_at", note: "" },
  { domain: "(pipeline)", column: "sync_status", note: "" },
] as const;

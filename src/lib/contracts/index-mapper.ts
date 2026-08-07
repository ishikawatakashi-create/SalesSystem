import type { ContractDomain } from "@/lib/notion/converters/contract";
import type { ContractIndexRow } from "@/lib/contracts/types";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize";

function buildContractSearchText(source: {
  title: string;
  billingTerms: string | null;
  note: string | null;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffNames?: string[];
}): string {
  const parts = [
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    source.billingTerms
      ? removeAllWhitespace(toSearchLower(source.billingTerms))
      : "",
    source.note ? removeAllWhitespace(toSearchLower(source.note)) : "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
    source.dealTitle
      ? removeAllWhitespace(toSearchLower(source.dealTitle))
      : "",
    ...(source.staffNames ?? []).map((n) =>
      n ? removeAllWhitespace(toSearchLower(n)) : "",
    ),
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

/**
 * Notionドメイン → contract_index upsert行。
 */
export function contractDomainToIndexRow(input: {
  contract: ContractDomain;
  staffUserIds: string[];
  statusSemantic: string | null;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: ContractIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffNames?: string[];
  nowIso?: string;
}): Omit<ContractIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const c = input.contract;

  return {
    notion_page_id: c.notionPageId,
    external_id: c.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    title: c.title,
    customer_page_id: c.customerPageId,
    deal_page_id: c.dealPageId,
    contract_type_id: c.contractTypePageId,
    trade_type_id: c.tradeTypePageId,
    amount: c.amount,
    contracted_at: c.contractedAt,
    start_date: c.startDate,
    end_date: c.endDate,
    auto_renew: c.autoRenew,
    billing_terms: c.billingTerms,
    payment_status_id: c.paymentStatusPageId,
    status_id: c.statusPageId,
    status_semantic: input.statusSemantic,
    staff_user_ids: input.staffUserIds,
    staff_page_ids: c.staffPageIds,
    has_contract_url: Boolean(c.contractUrl),
    has_contract_file: c.hasContractFile,
    note: c.note,
    search_text: buildContractSearchText({
      title: c.title,
      billingTerms: c.billingTerms,
      note: c.note,
      customerDisplayName: input.customerDisplayName,
      dealTitle: input.dealTitle,
      staffNames: input.staffNames,
    }),
  };
}

export const CONTRACT_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "title", column: "title", note: "契約名" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  { domain: "dealPageId", column: "deal_page_id", note: "関連案件" },
  {
    domain: "contractTypePageId",
    column: "contract_type_id",
    note: "契約区分",
  },
  { domain: "tradeTypePageId", column: "trade_type_id", note: "取引区分" },
  { domain: "amount", column: "amount", note: "" },
  { domain: "contractedAt", column: "contracted_at", note: "" },
  { domain: "startDate", column: "start_date", note: "" },
  { domain: "endDate", column: "end_date", note: "" },
  { domain: "autoRenew", column: "auto_renew", note: "" },
  { domain: "billingTerms", column: "billing_terms", note: "" },
  {
    domain: "paymentStatusPageId",
    column: "payment_status_id",
    note: "支払状況",
  },
  { domain: "statusPageId", column: "status_id", note: "契約状態" },
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
  { domain: "contractUrl", column: "has_contract_url", note: "有無" },
  { domain: "hasContractFile", column: "has_contract_file", note: "有無" },
  { domain: "note", column: "note", note: "" },
  { domain: "(computed)", column: "search_text", note: "" },
] as const;

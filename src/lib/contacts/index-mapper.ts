import type { ContactDomain } from "@/lib/notion/converters/contact";
import type { ContactIndexRow } from "@/lib/contacts/types";
import {
  normalizeEmailOrNull,
  normalizeKanaForSearch,
  normalizePhone,
  removeAllWhitespace,
  toSearchLower,
} from "@/lib/normalize";

function buildContactSearchText(source: {
  name: string;
  nameKana: string | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  customerDisplayName?: string | null;
}): string {
  const parts = [
    source.name ? removeAllWhitespace(toSearchLower(source.name)) : "",
    normalizeKanaForSearch(source.nameKana),
    source.department
      ? removeAllWhitespace(toSearchLower(source.department))
      : "",
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    normalizePhone(source.phone) ?? "",
    normalizeEmailOrNull(source.email) ?? "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

/**
 * Notionドメイン → contact_index upsert行。
 */
export function contactDomainToIndexRow(input: {
  contact: ContactDomain;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: ContactIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  /** 所属顧客の表示名(検索用。会社名検索のためsearch_textへ含める) */
  customerDisplayName?: string | null;
  nowIso?: string;
}): Omit<ContactIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const c = input.contact;

  return {
    notion_page_id: c.notionPageId,
    external_id: c.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    name: c.name,
    name_kana: c.nameKana,
    customer_page_id: c.customerPageId,
    department: c.department,
    title: c.title,
    phone: c.phone,
    phone_normalized: normalizePhone(c.phone),
    email: normalizeEmailOrNull(c.email),
    contact_type_id: c.contactTypePageId,
    note: c.note,
    is_active: c.isActive,
    search_text: buildContactSearchText({
      name: c.name,
      nameKana: c.nameKana,
      department: c.department,
      title: c.title,
      phone: c.phone,
      email: c.email,
      customerDisplayName: input.customerDisplayName,
    }),
  };
}

export const CONTACT_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "name", column: "name", note: "表示原文" },
  { domain: "nameKana", column: "name_kana", note: "表示原文" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  { domain: "department", column: "department", note: "" },
  { domain: "title", column: "title", note: "役職" },
  { domain: "phone", column: "phone", note: "表示原文" },
  {
    domain: "phone(normalized)",
    column: "phone_normalized",
    note: "数字のみ",
  },
  { domain: "email", column: "email", note: "lower/trim" },
  {
    domain: "contactTypePageId",
    column: "contact_type_id",
    note: "master page ID",
  },
  { domain: "note", column: "note", note: "" },
  { domain: "isActive", column: "is_active", note: "" },
  { domain: "(computed)", column: "content_hash", note: "" },
  { domain: "lastEditedTime", column: "notion_last_edited_at", note: "" },
  { domain: "(pipeline)", column: "sync_status", note: "" },
] as const;

import type { ContactDomain } from "@/lib/notion/converters/contact";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * 先方担当者書込入力(表示用原文)。
 * 空欄は null(空文字は正規化層で null 化)。
 */
export type ContactWriteInput = {
  name: string;
  nameKana: string | null;
  customerPageId: string;
  department: string | null;
  /** 役職(Notionページtitleではない) */
  title: string | null;
  phone: string | null;
  email: string | null;
  contactTypePageId: string | null;
  note: string | null;
  isActive: boolean;
};

export type ContactCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: ContactWriteInput;
  /** 省略時は新規UUIDを発行 */
  externalId?: string;
};

export type ContactUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  /** UI読込時の Notion last_edited_time(ISO) */
  expectedLastEditedTime: string;
  input: ContactWriteInput;
};

export type ContactWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  /** notion_done で後続失敗した場合 true */
  partialFailure?: boolean;
  warning?: string;
};

export type ContactIndexRow = {
  notion_page_id: string;
  external_id: string;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  name: string;
  name_kana: string | null;
  customer_page_id: string | null;
  department: string | null;
  title: string | null;
  /** 表示用電話番号原文 */
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  contact_type_id: string | null;
  note: string | null;
  is_active: boolean;
  search_text: string;
};

export type ContactRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    contactTypePageId: string | null;
  };
  expectedContentHash: string;
  expectedLastEditedTime?: string;
  displaySnapshot: ContactWriteInput;
};

/** 詳細読取結果。Notion正本。障害時にindexで偽装しない。 */
export type ContactDetail = ContactDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type ContactListSortKey =
  | "updated_at"
  | "name"
  | "name_kana"
  | "department"
  | "title";

export type ContactListQuery = {
  q?: string;
  customerPageId?: string;
  contactTypeId?: string;
  /** 省略時は有効のみ(true) */
  isActive?: boolean;
  sort?: ContactListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

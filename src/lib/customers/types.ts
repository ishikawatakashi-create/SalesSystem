import type { CustomerDomain } from "@/lib/notion/converters/customer";
import type { SyncStatus, WriteOpStatus } from "@/types/database";

/**
 * 顧客書込入力(表示用原文)。導出キャッシュ項目は含めない。
 * 空欄は null(空文字は正規化層で null 化)。
 */
export type CustomerWriteInput = {
  displayName: string;
  legalName: string | null;
  officeName: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  representativeName: string | null;
  website: string | null;
  businessCategoryPageIds: string[];
  tagPageIds: string[];
  relationshipPageIds: string[];
  salesStatusPageId: string | null;
  acquisitionRoutePageId: string | null;
  priorityPageId: string | null;
  staffPageIds: string[];
  relatedAccountPageIds: string[];
  isArchived: boolean;
};

export type CustomerCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: CustomerWriteInput;
  /** 省略時は新規UUIDを発行 */
  externalId?: string;
};

export type CustomerUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  /** UI読込時の Notion last_edited_time(ISO) */
  expectedLastEditedTime: string;
  input: CustomerWriteInput;
};

export type CustomerWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  /** notion_done で後続失敗した場合 true */
  partialFailure?: boolean;
  warning?: string;
};

export type CustomerIndexRow = {
  notion_page_id: string;
  external_id: string;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  display_name: string;
  legal_name: string | null;
  office_name: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address_line: string | null;
  phone_normalized: string | null;
  /** 表示用電話番号原文。検索は phone_normalized */
  phone: string | null;
  email: string | null;
  representative_name: string | null;
  website: string | null;
  business_category_ids: string[];
  tag_ids: string[];
  relationship_ids: string[];
  relationship_semantic_keys: string[];
  sales_status_id: string | null;
  acquisition_route_id: string | null;
  priority_id: string | null;
  staff_user_ids: string[];
  latest_activity_summary: string | null;
  last_activity_at: string | null;
  next_action: string | null;
  next_action_date: string | null;
  expected_amount: number | null;
  is_archived: boolean;
  search_text: string;
  search_text_kana: string;
};

export type WriteOperationRow = {
  request_id: string;
  entity_type: string;
  operation: string;
  external_id: string;
  input_hash: string;
  status: WriteOpStatus;
  notion_page_id: string | null;
  recovery_payload: CustomerRecoveryPayload | null;
  actor_id: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

export type CustomerRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    businessCategoryPageIds: string[];
    tagPageIds: string[];
    relationshipPageIds: string[];
    salesStatusPageId: string | null;
    acquisitionRoutePageId: string | null;
    priorityPageId: string | null;
    staffPageIds: string[];
    relatedAccountPageIds: string[];
  };
  expectedContentHash: string;
  expectedLastEditedTime?: string;
  displaySnapshot: CustomerWriteInput;
};

/** 詳細読取結果。Notion正本。障害時にindexで偽装しない。 */
export type CustomerDetail = CustomerDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type CustomerListSortKey =
  | "updated_at"
  | "display_name"
  | "last_activity_at"
  | "next_action_date"
  | "expected_amount";

export type CustomerListQuery = {
  q?: string;
  prefecture?: string;
  salesStatusId?: string;
  businessCategoryId?: string;
  /** Organization relationship semantic_key（単一 filter） */
  relationshipSemanticKey?: string;
  staffUserId?: string;
  isArchived?: boolean;
  sort?: CustomerListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

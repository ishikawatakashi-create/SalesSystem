import type { ActivityDomain } from "@/lib/notion/converters/activity";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * 対応履歴書込入力(表示用原文)。
 * 登録者/最終編集者は actor から設定(staff relation ではない)。
 * 空欄は null(空文字は正規化層で null 化)。
 */
export type ActivityWriteInput = {
  title: string;
  customerPageId: string;
  /** 関連案件(単一・任意)。配列ではない */
  dealPageId: string | null;
  contactPageIds: string[];
  /** ISO timestamptz */
  activityAt: string;
  categoryPageIds: string[];
  /** 空なら本文先頭200字から自動生成。手上書き可 */
  summary: string | null;
  /** 入力記録スナップショットのみ。アクション正本ではない */
  nextActionNote: string | null;
  nextActionDate: string | null;
  /** ページ本文(プロパティではない) */
  body: string;
  /** 一括登録時の batch_id。単発は null */
  batchId: string | null;
};

export type ActivityCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: ActivityWriteInput;
  /** 省略時は新規UUIDを発行 */
  externalId?: string;
};

export type ActivityUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  /** UI読込時の Notion last_edited_time(ISO) */
  expectedLastEditedTime: string;
  input: ActivityWriteInput;
};

export type ActivityWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  partialFailure?: boolean;
  warning?: string;
};

export type ActivityCreateResult = ActivityWriteResult;
export type ActivityUpdateResult = ActivityWriteResult;

export type ActivityBulkCreateRowInput = {
  rowId: string;
  requestId: string;
  input: ActivityWriteInput;
};

export type ActivityBulkCreateInput = {
  batchRequestId: string;
  /** 各行 input にマージする共通値(行側が優先) */
  common?: Partial<ActivityWriteInput>;
  rows: ActivityBulkCreateRowInput[];
};

export type ActivityBulkCreateRowResult = {
  rowId: string;
  requestId: string;
  status: WriteOpStatus | "error";
  externalId: string | null;
  notionPageId: string | null;
  errorCode?: string;
  errorMessage?: string;
  partialFailure?: boolean;
  warning?: string;
};

export type ActivityBulkCreateResult = {
  batchRequestId: string;
  rows: ActivityBulkCreateRowResult[];
};

export type ActivityIndexRow = {
  notion_page_id: string;
  external_id: string;
  content_hash: string | null;
  notion_last_edited_at: string | null;
  sync_status: SyncStatus;
  sync_error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  summary: string | null;
  body_hash: string | null;
  customer_page_id: string | null;
  deal_page_id: string | null;
  contact_page_ids: string[];
  activity_at: string | null;
  category_ids: string[];
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  batch_id: string | null;
  search_text: string;
};

export type ActivityRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    dealPageId: string | null;
    contactPageIds: string[];
    categoryPageIds: string[];
  };
  expectedContentHash: string;
  expectedBodyHash: string;
  expectedBodyVersion: number;
  oldBlockIds?: string[];
  newBlockIds?: string[];
  bodyStage?: "pending" | "appended" | "verified" | "cleaned";
  expectedLastEditedTime?: string;
  displaySnapshot: ActivityWriteInput;
};

/** 詳細読取結果。Notion正本。障害時にindexで偽装しない。 */
export type ActivityDetail = ActivityDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type ActivityListSortKey =
  | "updated_at"
  | "activity_at"
  | "title"
  | "created_at";

export type ActivityListQuery = {
  q?: string;
  customerPageId?: string;
  dealPageId?: string;
  contactPageId?: string;
  categoryId?: string;
  createdBy?: string;
  activityAtFrom?: string;
  activityAtTo?: string;
  batchId?: string;
  sort?: ActivityListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

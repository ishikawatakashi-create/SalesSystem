import type { DealDomain } from "@/lib/notion/converters/deal";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * 案件書込入力(表示用原文)。導出キャッシュ(次回アクション等)は含めない。
 * 空欄は null(空文字は正規化層で null 化)。
 */
export type DealWriteInput = {
  title: string;
  customerPageId: string;
  contactPageIds: string[];
  businessCategoryPageId: string | null;
  productName: string | null;
  stagePageId: string | null;
  staffPageIds: string[];
  expectedAmount: number | null;
  contractAmount: number | null;
  probability: number | null;
  expectedCloseDate: string | null;
  contractedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lostReason: string | null;
  statusPageId: string | null;
  note: string | null;
};

export type DealCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: DealWriteInput;
  /** 省略時は新規UUIDを発行 */
  externalId?: string;
};

export type DealUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  /** UI読込時の Notion last_edited_time(ISO) */
  expectedLastEditedTime: string;
  input: DealWriteInput;
};

export type DealWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  /** notion_done で後続失敗した場合 true */
  partialFailure?: boolean;
  warning?: string;
};

/** create / update の結果型(同一構造) */
export type DealCreateResult = DealWriteResult;
export type DealUpdateResult = DealWriteResult;

export type DealIndexRow = {
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
  customer_page_id: string | null;
  contact_page_ids: string[];
  business_category_id: string | null;
  product_name: string | null;
  stage_id: string | null;
  status_id: string | null;
  status_semantic: string | null;
  staff_user_ids: string[];
  staff_page_ids: string[];
  expected_amount: number | null;
  contract_amount: number | null;
  probability: number | null;
  expected_close_date: string | null;
  contracted_at: string | null;
  period_start: string | null;
  period_end: string | null;
  next_action: string | null;
  next_action_date: string | null;
  lost_reason: string | null;
  note: string | null;
  search_text: string;
};

export type DealRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    contactPageIds: string[];
    businessCategoryPageId: string | null;
    stagePageId: string | null;
    staffPageIds: string[];
    statusPageId: string | null;
  };
  expectedContentHash: string;
  expectedLastEditedTime?: string;
  displaySnapshot: DealWriteInput;
};

/** 詳細読取結果。Notion正本。障害時にindexで偽装しない。 */
export type DealDetail = DealDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type DealListSortKey =
  | "updated_at"
  | "title"
  | "expected_amount"
  | "expected_close_date"
  | "contracted_at"
  | "probability";

export type DealListQuery = {
  q?: string;
  customerPageId?: string;
  stageId?: string;
  statusId?: string;
  statusSemantic?: string;
  staffUserId?: string;
  /** 見込み金額下限(円・含む) */
  expectedAmountMin?: number;
  /** 見込み金額上限(円・含む) */
  expectedAmountMax?: number;
  /** 受注予定日 From (YYYY-MM-DD) */
  expectedCloseDateFrom?: string;
  /** 受注予定日 To (YYYY-MM-DD) */
  expectedCloseDateTo?: string;
  /** 契約日 From */
  contractedAtFrom?: string;
  /** 契約日 To */
  contractedAtTo?: string;
  sort?: DealListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

import type { ActionDomain } from "@/lib/notion/converters/action";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * 次回アクション書込入力(表示用原文)。
 * 自社担当者は単一。先方担当者プロパティは存在しない。
 */
export type ActionWriteInput = {
  title: string;
  customerPageId: string;
  dealPageId: string | null;
  activityPageId: string | null;
  /** 自社担当者(単一) */
  staffPageId: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
  statusPageId: string;
  priorityPageId: string | null;
  /** ISO timestamptz or date。完了時に空なら Asia/Tokyo の今日を設定 */
  completedAt: string | null;
};

export type ActionCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: ActionWriteInput;
  externalId?: string;
};

export type ActionUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  input: ActionWriteInput;
};

export type ActionWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  partialFailure?: boolean;
  warning?: string;
};

export type ActionCreateResult = ActionWriteResult;
export type ActionUpdateResult = ActionWriteResult;

export type ActionIndexRow = {
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
  customer_page_id: string;
  deal_page_id: string | null;
  activity_page_id: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
  due_date: string | null;
  status_id: string | null;
  is_open: boolean;
  priority_id: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  search_text: string;
};

export type ActionRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    dealPageId: string | null;
    activityPageId: string | null;
    staffPageId: string | null;
    statusPageId: string;
    priorityPageId: string | null;
  };
  expectedContentHash: string;
  expectedLastEditedTime?: string;
  displaySnapshot: ActionWriteInput;
};

export type ActionDetail = ActionDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type ActionListSortKey =
  | "updated_at"
  | "due_date"
  | "title"
  | "completed_at";

export type ActionListQuery = {
  q?: string;
  customerPageId?: string;
  dealPageId?: string;
  activityPageId?: string;
  assigneeUserId?: string;
  staffPageId?: string;
  statusId?: string;
  isOpen?: boolean;
  priorityId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  sort?: ActionListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/** アクション状態 semantic_key 定数(日本語名比較禁止) */
export const ACTION_OPEN_SEMANTIC = "open" as const;
export const ACTION_DONE_SEMANTIC = "done" as const;
export const ACTION_CANCELLED_SEMANTIC = "cancelled" as const;

export type ActionStatusSemantic =
  | typeof ACTION_OPEN_SEMANTIC
  | typeof ACTION_DONE_SEMANTIC
  | typeof ACTION_CANCELLED_SEMANTIC;

export function isActionOpenSemantic(
  key: string | null | undefined,
): boolean {
  return key === ACTION_OPEN_SEMANTIC;
}

export function isActionTerminalSemantic(
  key: string | null | undefined,
): boolean {
  return key === ACTION_DONE_SEMANTIC || key === ACTION_CANCELLED_SEMANTIC;
}

export function isActionDoneSemantic(
  key: string | null | undefined,
): boolean {
  return key === ACTION_DONE_SEMANTIC;
}

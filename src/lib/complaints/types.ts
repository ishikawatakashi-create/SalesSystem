import type { ComplaintDomain } from "@/lib/notion/converters/complaint";
import type { SyncStatus, WriteOpStatus } from "@/types/database";
import type { WriteOperationRow } from "@/lib/customers/types";

export type { WriteOperationRow };

/**
 * クレーム書込入力(表示用原文)。
 * 本文4セクションは空文字を null 化。contact relation は無い。
 */
export type ComplaintWriteInput = {
  title: string;
  customerPageId: string;
  dealPageId: string | null;
  severityPageId: string | null;
  statusPageId: string | null;
  staffPageId: string | null;
  occurredOn: string | null;
  /** 空なら本文先頭200字から自動生成 */
  summary: string | null;
  dueDate: string | null;
  completedOn: string | null;
  note: string | null;
  content: string | null;
  cause: string | null;
  response: string | null;
  prevention: string | null;
};

export type ComplaintCreateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  input: ComplaintWriteInput;
  externalId?: string;
};

export type ComplaintUpdateCommand = {
  requestId: string;
  actorId: string;
  actorName: string;
  notionPageId: string;
  externalId: string;
  expectedLastEditedTime: string;
  input: ComplaintWriteInput;
};

export type ComplaintWriteResult = {
  status: WriteOpStatus;
  requestId: string;
  externalId: string;
  notionPageId: string | null;
  partialFailure?: boolean;
  warning?: string;
};

export type ComplaintCreateResult = ComplaintWriteResult;
export type ComplaintUpdateResult = ComplaintWriteResult;

export type ComplaintIndexRow = {
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
  occurred_on: string | null;
  severity_id: string | null;
  assignee_user_id: string | null;
  staff_page_id: string | null;
  due_date: string | null;
  status_id: string | null;
  status_semantic: string | null;
  completed_on: string | null;
  note: string | null;
  search_text: string;
};

export type ComplaintRecoveryPayload = {
  expectedProperties: Record<string, unknown>;
  expectedRelations: {
    customerPageId: string;
    dealPageId: string | null;
    severityPageId: string | null;
    statusPageId: string | null;
    staffPageId: string | null;
  };
  expectedContentHash: string;
  expectedBodyHash: string;
  expectedBodyVersion: number;
  oldBlockIds?: string[];
  newBlockIds?: string[];
  bodyStage?: "pending" | "appended" | "verified" | "cleaned";
  expectedLastEditedTime?: string;
  displaySnapshot: ComplaintWriteInput;
};

export type ComplaintDetail = ComplaintDomain & {
  createdTime: string;
  lastEditedTime: string;
  contentHash: string;
};

export type ComplaintListSortKey =
  | "updated_at"
  | "occurred_on"
  | "due_date"
  | "title"
  | "created_at";

export type ComplaintListQuery = {
  q?: string;
  customerPageId?: string;
  dealPageId?: string;
  severityId?: string;
  statusId?: string;
  statusSemantic?: string;
  /** true のとき status_semantic !== done (open / in_progress) */
  unresolvedOnly?: boolean;
  staffUserId?: string;
  occurredOnFrom?: string;
  occurredOnTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  sort?: ComplaintListSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export const COMPLAINT_STATUS_SEMANTICS = {
  open: "open",
  in_progress: "in_progress",
  done: "done",
} as const;

export type ComplaintStatusSemantic =
  (typeof COMPLAINT_STATUS_SEMANTICS)[keyof typeof COMPLAINT_STATUS_SEMANTICS];

export const COMPLAINT_DONE_SEMANTIC = COMPLAINT_STATUS_SEMANTICS.done;

/** 未解決 = status_semantic !== 'done' */
export function isComplaintUnresolved(
  statusSemantic: string | null | undefined,
): boolean {
  return statusSemantic !== COMPLAINT_DONE_SEMANTIC;
}

export function isComplaintDoneSemantic(
  key: string | null | undefined,
): boolean {
  return key === COMPLAINT_DONE_SEMANTIC;
}

import type { ActionDomain } from "@/lib/notion/converters/action";
import type { ActionIndexRow } from "@/lib/actions/types";
import { isActionOpenSemantic } from "@/lib/actions/types";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize";

function buildActionSearchText(source: {
  title: string;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffName?: string | null;
  createdByName?: string | null;
}): string {
  const parts = [
    source.title ? removeAllWhitespace(toSearchLower(source.title)) : "",
    source.customerDisplayName
      ? removeAllWhitespace(toSearchLower(source.customerDisplayName))
      : "",
    source.dealTitle
      ? removeAllWhitespace(toSearchLower(source.dealTitle))
      : "",
    source.staffName
      ? removeAllWhitespace(toSearchLower(source.staffName))
      : "",
    source.createdByName
      ? removeAllWhitespace(toSearchLower(source.createdByName))
      : "",
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

export function actionDomainToIndexRow(input: {
  action: ActionDomain;
  assigneeUserId: string | null;
  statusSemantic: string | null;
  contentHash: string;
  notionLastEditedAt: string | null;
  syncStatus: ActionIndexRow["sync_status"];
  syncErrorMessage?: string | null;
  customerDisplayName?: string | null;
  dealTitle?: string | null;
  staffName?: string | null;
  nowIso?: string;
}): Omit<ActionIndexRow, "created_at" | "updated_at"> {
  const now = input.nowIso ?? new Date().toISOString();
  const a = input.action;

  return {
    notion_page_id: a.notionPageId,
    external_id: a.externalId,
    content_hash: input.contentHash,
    notion_last_edited_at: input.notionLastEditedAt,
    sync_status: input.syncStatus,
    sync_error_message: input.syncErrorMessage ?? null,
    last_synced_at: now,
    title: a.title,
    customer_page_id: a.customerPageId ?? "",
    deal_page_id: a.dealPageId,
    activity_page_id: a.activityPageId,
    assignee_user_id: input.assigneeUserId,
    staff_page_id: a.staffPageId,
    due_date: a.dueDate,
    status_id: a.statusPageId,
    is_open: isActionOpenSemantic(input.statusSemantic),
    priority_id: a.priorityPageId,
    completed_at: a.completedAt,
    created_by: a.createdById,
    created_by_name: a.createdByName,
    search_text: buildActionSearchText({
      title: a.title,
      customerDisplayName: input.customerDisplayName,
      dealTitle: input.dealTitle,
      staffName: input.staffName,
      createdByName: a.createdByName,
    }),
  };
}

export const ACTION_INDEX_FIELD_MAP = [
  { domain: "notionPageId", column: "notion_page_id", note: "PK" },
  { domain: "externalId", column: "external_id", note: "uuid" },
  { domain: "title", column: "title", note: "アクション内容" },
  { domain: "customerPageId", column: "customer_page_id", note: "" },
  { domain: "dealPageId", column: "deal_page_id", note: "案件・単一" },
  {
    domain: "activityPageId",
    column: "activity_page_id",
    note: "元対応履歴",
  },
  {
    domain: "staffPageId",
    column: "staff_page_id",
    note: "自社担当者・単一",
  },
  {
    domain: "staffPageId",
    column: "assignee_user_id",
    note: "app_users.id へ解決",
  },
  { domain: "dueDate", column: "due_date", note: "" },
  { domain: "statusPageId", column: "status_id", note: "アクション状態" },
  {
    domain: "(masters_cache)",
    column: "is_open",
    note: "semantic_key===open",
  },
  { domain: "priorityPageId", column: "priority_id", note: "優先度" },
  { domain: "completedAt", column: "completed_at", note: "" },
  { domain: "createdById", column: "created_by", note: "" },
  { domain: "createdByName", column: "created_by_name", note: "" },
  { domain: "(computed)", column: "search_text", note: "" },
] as const;

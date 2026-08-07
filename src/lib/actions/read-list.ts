import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { ActionIndexRow, ActionListQuery } from "@/lib/actions/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 次回アクション一覧・検索: action_index のみ(Notion APIは呼ばない)。
 */
export async function listActions(
  query: ActionListQuery = {},
): Promise<{ rows: ActionIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "due_date";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("action_index")
    .select("*", { count: "exact" })
    .order(sortKey, { ascending, nullsFirst: false })
    .order("notion_page_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.customerPageId) {
    q = q.eq("customer_page_id", query.customerPageId);
  }
  if (query.dealPageId) {
    q = q.eq("deal_page_id", query.dealPageId);
  }
  if (query.activityPageId) {
    q = q.eq("activity_page_id", query.activityPageId);
  }
  if (query.assigneeUserId) {
    q = q.eq("assignee_user_id", query.assigneeUserId);
  }
  if (query.staffPageId) {
    q = q.eq("staff_page_id", query.staffPageId);
  }
  if (query.statusId) {
    q = q.eq("status_id", query.statusId);
  }
  if (query.priorityId) {
    q = q.eq("priority_id", query.priorityId);
  }
  if (query.isOpen !== undefined) {
    q = q.eq("is_open", query.isOpen);
  }
  if (query.dueDateFrom) {
    q = q.gte("due_date", query.dueDateFrom);
  }
  if (query.dueDateTo) {
    q = q.lte("due_date", query.dueDateTo);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(`search_text.ilike.${term},title.ilike.${term}`);
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`action_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as ActionIndexRow[],
    count: count ?? null,
  };
}

export async function listOpenActionsByAssignee(
  assigneeUserId: string,
): Promise<ActionIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("action_index")
    .select("*")
    .eq("assignee_user_id", assigneeUserId)
    .eq("is_open", true)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`担当アクション一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as ActionIndexRow[];
}

export async function getActionIndexByPageId(
  notionPageId: string,
): Promise<ActionIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("action_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as ActionIndexRow) ?? null;
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import {
  COMPLAINT_DONE_SEMANTIC,
  type ComplaintIndexRow,
  type ComplaintListQuery,
} from "@/lib/complaints/types";
import { createClient } from "@/lib/supabase/server";

/**
 * クレーム一覧・検索: complaint_index のみ(Notion APIは呼ばない)。
 */
export async function listComplaints(
  query: ComplaintListQuery = {},
): Promise<{ rows: ComplaintIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "occurred_on";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("complaint_index")
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
  if (query.severityId) {
    q = q.eq("severity_id", query.severityId);
  }
  if (query.statusId) {
    q = q.eq("status_id", query.statusId);
  }
  if (query.statusSemantic) {
    q = q.eq("status_semantic", query.statusSemantic);
  }
  if (query.unresolvedOnly) {
    q = q.neq("status_semantic", COMPLAINT_DONE_SEMANTIC);
  }
  if (query.staffUserId) {
    q = q.eq("assignee_user_id", query.staffUserId);
  }
  if (query.occurredOnFrom) {
    q = q.gte("occurred_on", query.occurredOnFrom);
  }
  if (query.occurredOnTo) {
    q = q.lte("occurred_on", query.occurredOnTo);
  }
  if (query.dueDateFrom) {
    q = q.gte("due_date", query.dueDateFrom);
  }
  if (query.dueDateTo) {
    q = q.lte("due_date", query.dueDateTo);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(
      `search_text.ilike.${term},title.ilike.${term},summary.ilike.${term}`,
    );
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`complaint_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as ComplaintIndexRow[],
    count: count ?? null,
  };
}

export async function listComplaintsByCustomer(
  customerPageId: string,
): Promise<ComplaintIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .order("occurred_on", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(
      `顧客所属のクレーム一覧取得に失敗しました: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as ComplaintIndexRow[];
}

/** 未解決クレーム(対応状況≠完了)、対応期限昇順 */
export async function listUnresolvedComplaintsByCustomer(
  customerPageId: string,
): Promise<ComplaintIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .neq("status_semantic", COMPLAINT_DONE_SEMANTIC)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`未解決クレーム一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as ComplaintIndexRow[];
}

/** 案件に紐づくクレーム一覧 */
export async function listComplaintsByDeal(
  dealPageId: string,
): Promise<ComplaintIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_index")
    .select("*")
    .eq("deal_page_id", dealPageId)
    .order("occurred_on", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(
      `案件所属のクレーム一覧取得に失敗しました: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as ComplaintIndexRow[];
}

export async function getComplaintIndexByPageId(
  notionPageId: string,
): Promise<ComplaintIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as ComplaintIndexRow) ?? null;
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { ActivityIndexRow, ActivityListQuery } from "@/lib/activities/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 対応履歴一覧・検索: activity_index のみ(Notion APIは呼ばない)。
 */
export async function listActivities(
  query: ActivityListQuery = {},
): Promise<{ rows: ActivityIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "activity_at";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("activity_index")
    .select("*", { count: "exact" })
    .order(sortKey, { ascending, nullsFirst: false })
    .order("notion_page_id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.customerPageId) {
    q = q.eq("customer_page_id", query.customerPageId);
  }
  if (query.dealPageId) {
    q = q.eq("deal_page_id", query.dealPageId);
  }
  if (query.contactPageId) {
    q = q.contains("contact_page_ids", [query.contactPageId]);
  }
  if (query.categoryId) {
    q = q.contains("category_ids", [query.categoryId]);
  }
  if (query.createdBy) {
    q = q.eq("created_by", query.createdBy);
  }
  if (query.batchId) {
    q = q.eq("batch_id", query.batchId);
  }
  if (query.activityAtFrom) {
    q = q.gte("activity_at", query.activityAtFrom);
  }
  if (query.activityAtTo) {
    q = q.lte("activity_at", query.activityAtTo);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(
      `search_text.ilike.${term},title.ilike.${term},summary.ilike.${term}`,
    );
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`activity_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as ActivityIndexRow[],
    count: count ?? null,
  };
}

export async function listActivitiesByCustomer(
  customerPageId: string,
): Promise<ActivityIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .order("activity_at", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: false });

  if (error) {
    throw new Error(
      `顧客所属の対応履歴一覧取得に失敗しました: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as ActivityIndexRow[];
}

export async function getActivityIndexByPageId(
  notionPageId: string,
): Promise<ActivityIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as ActivityIndexRow) ?? null;
}

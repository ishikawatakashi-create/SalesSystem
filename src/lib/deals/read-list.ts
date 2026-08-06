import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { DealIndexRow, DealListQuery } from "@/lib/deals/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 案件一覧・検索: deal_index のみ(Notion APIは呼ばない)。
 * RLS + requireUser / requirePermission(customer.view) を通す。
 */
export async function listDeals(
  query: DealListQuery = {},
): Promise<{ rows: DealIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "updated_at";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("deal_index")
    .select("*", { count: "exact" })
    .order(sortKey, { ascending, nullsFirst: false })
    .order("notion_page_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.customerPageId) {
    q = q.eq("customer_page_id", query.customerPageId);
  }
  if (query.stageId) {
    q = q.eq("stage_id", query.stageId);
  }
  if (query.statusId) {
    q = q.eq("status_id", query.statusId);
  }
  if (query.statusSemantic) {
    q = q.eq("status_semantic", query.statusSemantic);
  }
  if (query.staffUserId) {
    q = q.contains("staff_user_ids", [query.staffUserId]);
  }
  if (query.expectedAmountMin !== undefined) {
    q = q.gte("expected_amount", query.expectedAmountMin);
  }
  if (query.expectedAmountMax !== undefined) {
    q = q.lte("expected_amount", query.expectedAmountMax);
  }
  if (query.expectedCloseDateFrom) {
    q = q.gte("expected_close_date", query.expectedCloseDateFrom);
  }
  if (query.expectedCloseDateTo) {
    q = q.lte("expected_close_date", query.expectedCloseDateTo);
  }
  if (query.contractedAtFrom) {
    q = q.gte("contracted_at", query.contractedAtFrom);
  }
  if (query.contractedAtTo) {
    q = q.lte("contracted_at", query.contractedAtTo);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(`search_text.ilike.${term},title.ilike.${term},product_name.ilike.${term}`);
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`deal_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as DealIndexRow[],
    count: count ?? null,
  };
}

/** 顧客に紐づく案件一覧(顧客詳細埋め込み用) */
export async function listDealsByCustomer(
  customerPageId: string,
): Promise<DealIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`顧客所属の案件一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as DealIndexRow[];
}

export async function getDealIndexByPageId(
  notionPageId: string,
): Promise<DealIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as DealIndexRow) ?? null;
}

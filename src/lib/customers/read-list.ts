import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { CustomerIndexRow, CustomerListQuery } from "@/lib/customers/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 顧客一覧・検索: customer_index のみ(Notion APIは呼ばない)。
 * RLS + requireUser / requirePermission を通す。
 */
export async function listCustomers(
  query: CustomerListQuery = {},
): Promise<{ rows: CustomerIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "updated_at";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("customer_index")
    .select("*", { count: "exact" })
    .order(sortKey, { ascending, nullsFirst: false })
    .order("notion_page_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (typeof query.isArchived === "boolean") {
    q = q.eq("is_archived", query.isArchived);
  } else {
    q = q.eq("is_archived", false);
  }
  if (query.prefecture) {
    q = q.eq("prefecture", query.prefecture);
  }
  if (query.salesStatusId) {
    q = q.eq("sales_status_id", query.salesStatusId);
  }
  if (query.businessCategoryId) {
    q = q.contains("business_category_ids", [query.businessCategoryId]);
  }
  if (query.staffUserId) {
    q = q.contains("staff_user_ids", [query.staffUserId]);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(
      `search_text.ilike.${term},search_text_kana.ilike.${term},phone_normalized.ilike.${term},display_name.ilike.${term},legal_name.ilike.${term}`,
    );
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`customer_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as CustomerIndexRow[],
    count: count ?? null,
  };
}

export async function getCustomerIndexByPageId(
  notionPageId: string,
): Promise<CustomerIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as CustomerIndexRow) ?? null;
}

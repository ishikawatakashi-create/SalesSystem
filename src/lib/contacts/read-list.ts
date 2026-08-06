import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import type { ContactIndexRow, ContactListQuery } from "@/lib/contacts/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 先方担当者一覧・検索: contact_index のみ(Notion APIは呼ばない)。
 * RLS + requireUser / requirePermission(customer.view) を通す。
 */
export async function listContacts(
  query: ContactListQuery = {},
): Promise<{ rows: ContactIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "updated_at";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("contact_index")
    .select("*", { count: "exact" })
    .order(sortKey, { ascending, nullsFirst: false })
    .order("notion_page_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (typeof query.isActive === "boolean") {
    q = q.eq("is_active", query.isActive);
  } else {
    q = q.eq("is_active", true);
  }
  if (query.customerPageId) {
    q = q.eq("customer_page_id", query.customerPageId);
  }
  if (query.contactTypeId) {
    q = q.eq("contact_type_id", query.contactTypeId);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(
      `search_text.ilike.${term},name.ilike.${term},name_kana.ilike.${term},phone_normalized.ilike.${term},email.ilike.${term}`,
    );
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`contact_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as ContactIndexRow[],
    count: count ?? null,
  };
}

/** 顧客に紐づく担当者一覧(顧客詳細埋め込み用) */
export async function listContactsByCustomer(
  customerPageId: string,
  options: { includeInactive?: boolean } = {},
): Promise<ContactIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  let q = supabase
    .from("contact_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .order("name", { ascending: true })
    .order("notion_page_id", { ascending: true });

  if (!options.includeInactive) {
    q = q.eq("is_active", true);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(
      `顧客所属の担当者一覧取得に失敗しました: ${error.message}`,
    );
  }
  return (data ?? []) as unknown as ContactIndexRow[];
}

export async function getContactIndexByPageId(
  notionPageId: string,
): Promise<ContactIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as ContactIndexRow) ?? null;
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import {
  CONTRACT_ACTIVE_SEMANTIC,
  type ContractIndexRow,
  type ContractListQuery,
} from "@/lib/contracts/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 契約一覧・検索: contract_index のみ(Notion APIは呼ばない)。
 */
export async function listContracts(
  query: ContractListQuery = {},
): Promise<{ rows: ContractIndexRow[]; count: number | null }> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const sortKey = query.sort ?? "updated_at";
  const ascending = query.sortDir === "asc";

  let q = supabase
    .from("contract_index")
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
  if (query.tradeTypeId) {
    q = q.eq("trade_type_id", query.tradeTypeId);
  }
  if (query.statusId) {
    q = q.eq("status_id", query.statusId);
  }
  if (query.statusSemantic) {
    q = q.eq("status_semantic", query.statusSemantic);
  }
  if (query.paymentStatusId) {
    q = q.eq("payment_status_id", query.paymentStatusId);
  }
  if (query.staffUserId) {
    q = q.contains("staff_user_ids", [query.staffUserId]);
  }
  if (query.endDateFrom) {
    q = q.gte("end_date", query.endDateFrom);
  }
  if (query.endDateTo) {
    q = q.lte("end_date", query.endDateTo);
  }
  if (query.contractedAtFrom) {
    q = q.gte("contracted_at", query.contractedAtFrom);
  }
  if (query.contractedAtTo) {
    q = q.lte("contracted_at", query.contractedAtTo);
  }
  if (query.amountMin !== undefined) {
    q = q.gte("amount", query.amountMin);
  }
  if (query.amountMax !== undefined) {
    q = q.lte("amount", query.amountMax);
  }
  if (query.q && query.q.trim()) {
    const term = `%${query.q.trim()}%`;
    q = q.or(`search_text.ilike.${term},title.ilike.${term}`);
  }

  const { data, error, count } = await q;
  if (error) {
    throw new Error(`contract_index一覧取得に失敗しました: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as ContractIndexRow[],
    count: count ?? null,
  };
}

/** 顧客に紐づく契約一覧 */
export async function listContractsByCustomer(
  customerPageId: string,
): Promise<ContractIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`顧客所属の契約一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as ContractIndexRow[];
}

/** 顧客詳細「有効契約」: status_semantic=active、終了日昇順 */
export async function listActiveContractsByCustomer(
  customerPageId: string,
): Promise<ContractIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_index")
    .select("*")
    .eq("customer_page_id", customerPageId)
    .eq("status_semantic", CONTRACT_ACTIVE_SEMANTIC)
    .order("end_date", { ascending: true, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`有効契約一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as ContractIndexRow[];
}

/** 案件に紐づく契約一覧 */
export async function listContractsByDeal(
  dealPageId: string,
): Promise<ContractIndexRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_index")
    .select("*")
    .eq("deal_page_id", dealPageId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("notion_page_id", { ascending: true });

  if (error) {
    throw new Error(`案件所属の契約一覧取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as ContractIndexRow[];
}

export async function getContractIndexByPageId(
  notionPageId: string,
): Promise<ContractIndexRow | null> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_index")
    .select("*")
    .eq("notion_page_id", notionPageId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as ContractIndexRow) ?? null;
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import type { MastersCacheRow } from "@/types/database";

/**
 * masters_cache読取(RLS経由)。一覧フィルター・フォーム選択肢用。
 * Notion APIは呼ばない。
 */
export async function listMasters(input?: {
  types?: string[];
  includeInactive?: boolean;
}): Promise<MastersCacheRow[]> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const supabase = await createClient();
  let q = supabase
    .from("masters_cache")
    .select("*")
    .order("master_type", { ascending: true })
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (input?.types && input.types.length > 0) {
    q = q.in("master_type", input.types);
  }
  if (!input?.includeInactive) {
    q = q.eq("is_active", true);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(`masters_cache取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as MastersCacheRow[];
}

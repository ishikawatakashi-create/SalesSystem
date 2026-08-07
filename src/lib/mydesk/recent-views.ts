import "server-only";

import { createClient } from "@/lib/supabase/server";

export type RecentViewRow = {
  customerPageId: string;
  viewedAt: string;
  customerName: string | null;
};

/**
 * 顧客詳細閲覧を記録する(本人のみ RLS)。
 * 失敗しても画面表示は止めない。
 */
export async function touchRecentView(
  userId: string,
  customerPageId: string,
): Promise<void> {
  if (!userId || !customerPageId) return;
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("recent_views").upsert(
      {
        user_id: userId,
        customer_page_id: customerPageId,
        viewed_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,customer_page_id" },
    );
    if (error) {
      // PII/UUIDは出さない
      console.error("[recent_views] touch failed");
    }
  } catch {
    console.error("[recent_views] touch unexpected error");
  }
}

export async function listRecentViews(
  userId: string,
  limit = 8,
): Promise<RecentViewRow[]> {
  if (!userId) return [];
  const supabase = await createClient();
  const capped = Math.min(Math.max(limit, 1), 30);
  const { data, error } = await supabase
    .from("recent_views")
    .select("customer_page_id,viewed_at")
    .eq("user_id", userId)
    .order("viewed_at", { ascending: false })
    .limit(capped);

  if (error || !data) {
    if (error) console.error("[recent_views] list failed");
    return [];
  }

  const rows = data as unknown as Array<{
    customer_page_id: string;
    viewed_at: string;
  }>;
  const pageIds = rows.map((r) => r.customer_page_id).filter(Boolean);
  const nameMap = new Map<string, string>();
  if (pageIds.length > 0) {
    const { data: customers } = await supabase
      .from("customer_index")
      .select("notion_page_id,display_name")
      .in("notion_page_id", pageIds);
    for (const c of (customers ?? []) as Array<{
      notion_page_id: string;
      display_name: string;
    }>) {
      nameMap.set(c.notion_page_id, c.display_name);
    }
  }

  return rows.map((r) => ({
    customerPageId: r.customer_page_id,
    viewedAt: r.viewed_at,
    customerName: nameMap.get(r.customer_page_id) ?? null,
  }));
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MastersCacheRow } from "@/types/database";

/**
 * 先方担当者フォームの選択肢。
 * - 新規選択肢: 非アーカイブ顧客 / 有効な担当者区分のみ
 * - 更新時: 現在値として維持しているアーカイブ顧客・無効区分も含める
 */

export type CustomerOption = {
  pageId: string;
  displayName: string;
  isArchived: boolean;
};

export type MasterOption = {
  pageId: string;
  name: string;
  isActive: boolean;
};

export type ContactFormOptions = {
  customers: CustomerOption[];
  contactTypes: MasterOption[];
};

export async function loadContactFormOptions(input?: {
  currentCustomerPageId?: string;
  currentContactTypePageId?: string;
  /** 予約: 将来の自己参照除外用。現状未使用 */
  selfContactId?: string;
}): Promise<ContactFormOptions> {
  const user = await requireUser();
  requirePermission(user, "contact.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentTypeId = input?.currentContactTypePageId ?? null;

  const [customersRes, typesRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name,is_archived")
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order,is_active")
      .eq("master_type", "担当者区分")
      .order("sort_order", { ascending: true, nullsFirst: false }),
  ]);
  for (const r of [customersRes, typesRes]) {
    if (r.error) {
      throw new Error(`フォーム選択肢の取得に失敗しました: ${r.error.message}`);
    }
  }

  const customers: CustomerOption[] = [];
  for (const raw of (customersRes.data ?? []) as {
    notion_page_id: string;
    display_name: string;
    is_archived: boolean;
  }[]) {
    if (raw.is_archived && raw.notion_page_id !== currentCustomerId) continue;
    customers.push({
      pageId: raw.notion_page_id,
      displayName: raw.display_name,
      isArchived: raw.is_archived,
    });
  }

  const contactTypes: MasterOption[] = [];
  for (const raw of (typesRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "name" | "is_active"
  >[]) {
    if (!raw.is_active && raw.notion_page_id !== currentTypeId) continue;
    contactTypes.push({
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    });
  }

  return { customers, contactTypes };
}

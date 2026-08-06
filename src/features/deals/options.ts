import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MastersCacheRow } from "@/types/database";

/**
 * 案件フォームの選択肢。
 * - 新規選択肢: 非アーカイブ顧客 / 有効マスタ / 有効担当者 / 有効な顧客担当者
 * - 更新時: 現在値として維持している無効・アーカイブも含める
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

export type StaffOption = {
  pageId: string;
  name: string;
  isActive: boolean;
};

export type ContactOption = {
  pageId: string;
  name: string;
  customerPageId: string;
  isActive: boolean;
};

export type DealFormOptions = {
  customers: CustomerOption[];
  contacts: ContactOption[];
  businessCategories: MasterOption[];
  stages: MasterOption[];
  statuses: MasterOption[];
  staff: StaffOption[];
};

export async function loadDealFormOptions(input?: {
  currentCustomerPageId?: string;
  currentContactPageIds?: string[];
  currentBusinessCategoryPageId?: string;
  currentStagePageId?: string;
  currentStatusPageId?: string;
  currentStaffPageIds?: string[];
}): Promise<DealFormOptions> {
  const user = await requireUser();
  requirePermission(user, "deal.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentContactIds = new Set(input?.currentContactPageIds ?? []);
  const currentBizId = input?.currentBusinessCategoryPageId ?? null;
  const currentStageId = input?.currentStagePageId ?? null;
  const currentStatusId = input?.currentStatusPageId ?? null;
  const currentStaffIds = new Set(input?.currentStaffPageIds ?? []);

  const [customersRes, contactsRes, mastersRes, staffRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name,is_archived")
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("contact_index")
      .select("notion_page_id,name,customer_page_id,is_active")
      .order("name", { ascending: true })
      .limit(3000),
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order,is_active")
      .in("master_type", ["事業区分", "案件ステージ", "案件ステータス"])
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("notion_staff_page_id,display_name,is_active")
      .not("notion_staff_page_id", "is", null),
  ]);
  for (const r of [customersRes, contactsRes, mastersRes, staffRes]) {
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

  const contacts: ContactOption[] = [];
  for (const raw of (contactsRes.data ?? []) as {
    notion_page_id: string;
    name: string;
    customer_page_id: string | null;
    is_active: boolean;
  }[]) {
    if (!raw.customer_page_id) continue;
    if (!raw.is_active && !currentContactIds.has(raw.notion_page_id)) continue;
    contacts.push({
      pageId: raw.notion_page_id,
      name: raw.name,
      customerPageId: raw.customer_page_id,
      isActive: raw.is_active,
    });
  }

  const businessCategories: MasterOption[] = [];
  const stages: MasterOption[] = [];
  const statuses: MasterOption[] = [];
  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "master_type" | "name" | "is_active"
  >[]) {
    const keepInactive =
      (raw.master_type === "事業区分" &&
        raw.notion_page_id === currentBizId) ||
      (raw.master_type === "案件ステージ" &&
        raw.notion_page_id === currentStageId) ||
      (raw.master_type === "案件ステータス" &&
        raw.notion_page_id === currentStatusId);
    if (!raw.is_active && !keepInactive) continue;
    const opt: MasterOption = {
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    };
    if (raw.master_type === "事業区分") businessCategories.push(opt);
    else if (raw.master_type === "案件ステージ") stages.push(opt);
    else if (raw.master_type === "案件ステータス") statuses.push(opt);
  }

  const staff: StaffOption[] = [];
  for (const raw of (staffRes.data ?? []) as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  }[]) {
    if (!raw.is_active && !currentStaffIds.has(raw.notion_staff_page_id)) {
      continue;
    }
    staff.push({
      pageId: raw.notion_staff_page_id,
      name: raw.display_name,
      isActive: raw.is_active,
    });
  }

  return {
    customers,
    contacts,
    businessCategories,
    stages,
    statuses,
    staff,
  };
}

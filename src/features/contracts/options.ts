import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MastersCacheRow } from "@/types/database";

/**
 * 契約フォームの選択肢。
 * - 新規選択肢: 非アーカイブ顧客 / 有効マスタ / 有効担当者
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

export type DealOption = {
  pageId: string;
  title: string;
  customerPageId: string;
};

export type ContractFormOptions = {
  customers: CustomerOption[];
  deals: DealOption[];
  contractTypes: MasterOption[];
  tradeTypes: MasterOption[];
  paymentStatuses: MasterOption[];
  statuses: MasterOption[];
  staff: StaffOption[];
};

export async function loadContractFormOptions(input?: {
  currentCustomerPageId?: string;
  currentDealPageId?: string;
  currentContractTypePageId?: string;
  currentTradeTypePageId?: string;
  currentPaymentStatusPageId?: string;
  currentStatusPageId?: string;
  currentStaffPageIds?: string[];
}): Promise<ContractFormOptions> {
  const user = await requireUser();
  requirePermission(user, "contract.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentDealId = input?.currentDealPageId ?? null;
  const currentContractTypeId = input?.currentContractTypePageId ?? null;
  const currentTradeTypeId = input?.currentTradeTypePageId ?? null;
  const currentPaymentId = input?.currentPaymentStatusPageId ?? null;
  const currentStatusId = input?.currentStatusPageId ?? null;
  const currentStaffIds = new Set(input?.currentStaffPageIds ?? []);

  const [customersRes, dealsRes, mastersRes, staffRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name,is_archived")
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("deal_index")
      .select("notion_page_id,title,customer_page_id")
      .order("title", { ascending: true })
      .limit(3000),
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order,is_active")
      .in("master_type", ["契約区分", "取引区分", "支払状況", "契約状態"])
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("notion_staff_page_id,display_name,is_active")
      .not("notion_staff_page_id", "is", null),
  ]);
  for (const r of [customersRes, dealsRes, mastersRes, staffRes]) {
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

  const deals: DealOption[] = [];
  for (const raw of (dealsRes.data ?? []) as {
    notion_page_id: string;
    title: string;
    customer_page_id: string | null;
  }[]) {
    if (!raw.customer_page_id) continue;
    if (
      raw.notion_page_id !== currentDealId &&
      !customers.some((c) => c.pageId === raw.customer_page_id)
    ) {
      // アーカイブ顧客の案件は現行顧客維持時以外は出さない
      continue;
    }
    deals.push({
      pageId: raw.notion_page_id,
      title: raw.title || "(無題)",
      customerPageId: raw.customer_page_id,
    });
  }

  const contractTypes: MasterOption[] = [];
  const tradeTypes: MasterOption[] = [];
  const paymentStatuses: MasterOption[] = [];
  const statuses: MasterOption[] = [];
  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "master_type" | "name" | "is_active"
  >[]) {
    const keepInactive =
      (raw.master_type === "契約区分" &&
        raw.notion_page_id === currentContractTypeId) ||
      (raw.master_type === "取引区分" &&
        raw.notion_page_id === currentTradeTypeId) ||
      (raw.master_type === "支払状況" &&
        raw.notion_page_id === currentPaymentId) ||
      (raw.master_type === "契約状態" &&
        raw.notion_page_id === currentStatusId);
    if (!raw.is_active && !keepInactive) continue;
    const opt: MasterOption = {
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    };
    if (raw.master_type === "契約区分") contractTypes.push(opt);
    else if (raw.master_type === "取引区分") tradeTypes.push(opt);
    else if (raw.master_type === "支払状況") paymentStatuses.push(opt);
    else if (raw.master_type === "契約状態") statuses.push(opt);
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
    deals,
    contractTypes,
    tradeTypes,
    paymentStatuses,
    statuses,
    staff,
  };
}

import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MastersCacheRow } from "@/types/database";

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

export type ComplaintFormOptions = {
  customers: CustomerOption[];
  deals: DealOption[];
  severities: MasterOption[];
  statuses: MasterOption[];
  staff: StaffOption[];
};

export async function loadComplaintFormOptions(input?: {
  currentCustomerPageId?: string;
  currentDealPageId?: string;
  currentSeverityPageId?: string;
  currentStatusPageId?: string;
  currentStaffPageId?: string;
}): Promise<ComplaintFormOptions> {
  const user = await requireUser();
  requirePermission(user, "complaint.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentSeverityId = input?.currentSeverityPageId ?? null;
  const currentStatusId = input?.currentStatusPageId ?? null;
  const currentStaffId = input?.currentStaffPageId ?? null;

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
      .in("master_type", ["クレーム重要度", "クレーム対応状況"])
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
    deals.push({
      pageId: raw.notion_page_id,
      title: raw.title || "(無題)",
      customerPageId: raw.customer_page_id,
    });
  }

  const severities: MasterOption[] = [];
  const statuses: MasterOption[] = [];
  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "master_type" | "name" | "is_active"
  >[]) {
    const keepInactive =
      (raw.master_type === "クレーム重要度" &&
        raw.notion_page_id === currentSeverityId) ||
      (raw.master_type === "クレーム対応状況" &&
        raw.notion_page_id === currentStatusId);
    if (!raw.is_active && !keepInactive) continue;
    const opt: MasterOption = {
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    };
    if (raw.master_type === "クレーム重要度") severities.push(opt);
    else if (raw.master_type === "クレーム対応状況") statuses.push(opt);
  }

  const staff: StaffOption[] = [];
  for (const raw of (staffRes.data ?? []) as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  }[]) {
    if (!raw.is_active && raw.notion_staff_page_id !== currentStaffId) {
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
    severities,
    statuses,
    staff,
  };
}

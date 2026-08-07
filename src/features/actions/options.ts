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
  semanticKey?: string | null;
};

export type DealOption = {
  pageId: string;
  title: string;
  customerPageId: string;
};

export type StaffOption = {
  pageId: string;
  name: string;
  isActive: boolean;
};

export type ActivityOption = {
  pageId: string;
  title: string;
  customerPageId: string;
};

export type ActionFormOptions = {
  customers: CustomerOption[];
  deals: DealOption[];
  activities: ActivityOption[];
  statuses: MasterOption[];
  priorities: MasterOption[];
  staff: StaffOption[];
  defaultOpenStatusPageId: string | null;
  defaultDoneStatusPageId: string | null;
};

export async function loadActionFormOptions(input?: {
  currentCustomerPageId?: string;
  currentDealPageId?: string;
  currentActivityPageId?: string;
  currentStaffPageId?: string;
  currentStatusPageId?: string;
  currentPriorityPageId?: string;
}): Promise<ActionFormOptions> {
  const user = await requireUser();
  requirePermission(user, "action.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentDealId = input?.currentDealPageId ?? null;
  const currentActivityId = input?.currentActivityPageId ?? null;
  const currentStaffId = input?.currentStaffPageId ?? null;
  const currentStatusId = input?.currentStatusPageId ?? null;
  const currentPriorityId = input?.currentPriorityPageId ?? null;

  const [customersRes, dealsRes, activitiesRes, mastersRes, staffRes] =
    await Promise.all([
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
        .from("activity_index")
        .select("notion_page_id,title,customer_page_id")
        .order("activity_at", { ascending: false, nullsFirst: false })
        .limit(500),
      admin
        .from("masters_cache")
        .select(
          "notion_page_id,master_type,name,sort_order,is_active,semantic_key",
        )
        .in("master_type", ["アクション状態", "優先度"])
        .order("sort_order", { ascending: true, nullsFirst: false }),
      admin
        .from("app_users")
        .select("notion_staff_page_id,display_name,is_active")
        .not("notion_staff_page_id", "is", null),
    ]);

  for (const r of [
    customersRes,
    dealsRes,
    activitiesRes,
    mastersRes,
    staffRes,
  ]) {
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
  if (currentDealId && !deals.some((d) => d.pageId === currentDealId)) {
    const { data } = await admin
      .from("deal_index")
      .select("notion_page_id,title,customer_page_id")
      .eq("notion_page_id", currentDealId)
      .maybeSingle();
    if (data) {
      const row = data as {
        notion_page_id: string;
        title: string;
        customer_page_id: string | null;
      };
      if (row.customer_page_id) {
        deals.unshift({
          pageId: row.notion_page_id,
          title: row.title || "(無題)",
          customerPageId: row.customer_page_id,
        });
      }
    }
  }

  const activities: ActivityOption[] = [];
  for (const raw of (activitiesRes.data ?? []) as {
    notion_page_id: string;
    title: string;
    customer_page_id: string | null;
  }[]) {
    if (!raw.customer_page_id) continue;
    activities.push({
      pageId: raw.notion_page_id,
      title: raw.title || "(無題)",
      customerPageId: raw.customer_page_id,
    });
  }
  if (
    currentActivityId &&
    !activities.some((a) => a.pageId === currentActivityId)
  ) {
    const { data } = await admin
      .from("activity_index")
      .select("notion_page_id,title,customer_page_id")
      .eq("notion_page_id", currentActivityId)
      .maybeSingle();
    if (data) {
      const row = data as {
        notion_page_id: string;
        title: string;
        customer_page_id: string | null;
      };
      if (row.customer_page_id) {
        activities.unshift({
          pageId: row.notion_page_id,
          title: row.title || "(無題)",
          customerPageId: row.customer_page_id,
        });
      }
    }
  }

  const statuses: MasterOption[] = [];
  const priorities: MasterOption[] = [];
  let defaultOpenStatusPageId: string | null = null;
  let defaultDoneStatusPageId: string | null = null;

  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    | "notion_page_id"
    | "master_type"
    | "name"
    | "is_active"
    | "semantic_key"
  >[]) {
    const keepInactive =
      (raw.master_type === "アクション状態" &&
        raw.notion_page_id === currentStatusId) ||
      (raw.master_type === "優先度" &&
        raw.notion_page_id === currentPriorityId);
    if (!raw.is_active && !keepInactive) continue;
    const opt: MasterOption = {
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
      semanticKey: raw.semantic_key,
    };
    if (raw.master_type === "アクション状態") {
      statuses.push(opt);
      if (raw.semantic_key === "open" && raw.is_active) {
        defaultOpenStatusPageId = raw.notion_page_id;
      }
      if (raw.semantic_key === "done" && raw.is_active) {
        defaultDoneStatusPageId = raw.notion_page_id;
      }
    } else if (raw.master_type === "優先度") {
      priorities.push(opt);
    }
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
    activities,
    statuses,
    priorities,
    staff,
    defaultOpenStatusPageId,
    defaultDoneStatusPageId,
  };
}

/** 完了状態マスタの pageId を取得(Server Action 用) */
export async function resolveActionStatusPageIdBySemantic(
  semanticKey: "open" | "done" | "cancelled",
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "アクション状態")
    .eq("semantic_key", semanticKey)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { notion_page_id: string } | null)?.notion_page_id ?? null;
}

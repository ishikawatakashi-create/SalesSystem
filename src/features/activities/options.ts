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

export type ContactOption = {
  pageId: string;
  name: string;
  customerPageId: string;
  isActive: boolean;
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

export type ActivityFormOptions = {
  customers: CustomerOption[];
  contacts: ContactOption[];
  deals: DealOption[];
  categories: MasterOption[];
  /** 続けて次回アクション登録用 */
  priorities: MasterOption[];
  staff: StaffOption[];
  defaultOpenStatusPageId: string | null;
};

export async function loadActivityFormOptions(input?: {
  currentCustomerPageId?: string;
  currentContactPageIds?: string[];
  currentDealPageId?: string;
  currentCategoryPageIds?: string[];
}): Promise<ActivityFormOptions> {
  const user = await requireUser();
  requirePermission(user, "activity.edit");

  const admin = createAdminClient();
  const currentCustomerId = input?.currentCustomerPageId ?? null;
  const currentContactIds = new Set(input?.currentContactPageIds ?? []);
  const currentDealId = input?.currentDealPageId ?? null;
  const currentCategoryIds = new Set(input?.currentCategoryPageIds ?? []);

  const [
    customersRes,
    contactsRes,
    dealsRes,
    mastersRes,
    staffRes,
    openStatusRes,
  ] = await Promise.all([
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
      .from("deal_index")
      .select("notion_page_id,title,customer_page_id")
      .order("title", { ascending: true })
      .limit(3000),
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order,is_active")
      .in("master_type", ["対応履歴分類", "優先度"])
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("notion_staff_page_id,display_name,is_active")
      .not("notion_staff_page_id", "is", null),
    admin
      .from("masters_cache")
      .select("notion_page_id")
      .eq("master_type", "アクション状態")
      .eq("semantic_key", "open")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  for (const r of [
    customersRes,
    contactsRes,
    dealsRes,
    mastersRes,
    staffRes,
    openStatusRes,
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

  const deals: DealOption[] = [];
  for (const raw of (dealsRes.data ?? []) as {
    notion_page_id: string;
    title: string;
    customer_page_id: string | null;
  }[]) {
    if (!raw.customer_page_id) continue;
    if (
      currentDealId &&
      raw.notion_page_id !== currentDealId &&
      currentCustomerId &&
      raw.customer_page_id !== currentCustomerId
    ) {
      // keep all for filter; include current deal always
    }
    deals.push({
      pageId: raw.notion_page_id,
      title: raw.title || "(無題)",
      customerPageId: raw.customer_page_id,
    });
  }
  // ensure current deal is present
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

  const categories: MasterOption[] = [];
  const priorities: MasterOption[] = [];
  for (const raw of (mastersRes.data ?? []) as Pick<
    MastersCacheRow,
    "notion_page_id" | "master_type" | "name" | "is_active"
  >[]) {
    const keepInactive =
      raw.master_type === "対応履歴分類" &&
      currentCategoryIds.has(raw.notion_page_id);
    if (!raw.is_active && !keepInactive) continue;
    const opt: MasterOption = {
      pageId: raw.notion_page_id,
      name: raw.name,
      isActive: raw.is_active,
    };
    if (raw.master_type === "対応履歴分類") categories.push(opt);
    else if (raw.master_type === "優先度") priorities.push(opt);
  }

  const staff: StaffOption[] = [];
  for (const raw of (staffRes.data ?? []) as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  }[]) {
    if (!raw.is_active) continue;
    staff.push({
      pageId: raw.notion_staff_page_id,
      name: raw.display_name,
      isActive: raw.is_active,
    });
  }

  const openRow = openStatusRes.data as { notion_page_id: string } | null;

  return {
    customers,
    contacts,
    deals,
    categories,
    priorities,
    staff,
    defaultOpenStatusPageId: openRow?.notion_page_id ?? null,
  };
}

import "server-only";

import type { CustomerIndexRow } from "@/lib/customers/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 一覧表示用のラベル解決とフィルター選択肢。
 * customer_index行のID列(マスタページID / app_users.id)を名称へ一括解決する。
 * Notion APIは呼ばない。呼出元でrequireUser/requirePermission済みであること。
 */

export type ListLabelMaps = {
  masterNames: Map<string, string>;
  staffNames: Map<string, string>;
};

export type ListFilterOptions = {
  salesStatuses: { pageId: string; name: string }[];
  businessCategories: { pageId: string; name: string }[];
  staff: { userId: string; name: string }[];
  prefectures: string[];
};

export async function loadListLabelMaps(
  rows: CustomerIndexRow[],
): Promise<ListLabelMaps> {
  const masterIds = new Set<string>();
  const staffIds = new Set<string>();
  for (const row of rows) {
    if (row.sales_status_id) masterIds.add(row.sales_status_id);
    if (row.priority_id) masterIds.add(row.priority_id);
    if (row.acquisition_route_id) masterIds.add(row.acquisition_route_id);
    for (const id of row.business_category_ids) masterIds.add(id);
    for (const id of row.tag_ids) masterIds.add(id);
    for (const id of row.staff_user_ids) staffIds.add(id);
  }

  const admin = createAdminClient();
  const [mastersRes, staffRes] = await Promise.all([
    masterIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name")
          .in("notion_page_id", [...masterIds]),
    staffIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("id,display_name")
          .in("id", [...staffIds]),
  ]);
  if (mastersRes.error) throw new Error(mastersRes.error.message);
  if (staffRes.error) throw new Error(staffRes.error.message);

  return {
    masterNames: new Map(
      ((mastersRes.data ?? []) as { notion_page_id: string; name: string }[]).map(
        (m) => [m.notion_page_id, m.name],
      ),
    ),
    staffNames: new Map(
      ((staffRes.data ?? []) as { id: string; display_name: string }[]).map(
        (u) => [u.id, u.display_name],
      ),
    ),
  };
}

export type DetailLabelMaps = {
  masterNames: Map<string, string>;
  /** notion_staff_page_id → 表示名 */
  staffNamesByPageId: Map<string, string>;
  /** 関連アカウント notion_page_id → { 表示名, アーカイブ } */
  relatedCustomers: Map<string, { displayName: string; isArchived: boolean }>;
  /** 無効マスタのID集合(「無効」表示用) */
  inactiveMasterIds: Set<string>;
  inactiveStaffPageIds: Set<string>;
};

export async function loadDetailLabelMaps(detail: {
  businessCategoryPageIds: string[];
  tagPageIds: string[];
  salesStatusPageId: string | null;
  acquisitionRoutePageId: string | null;
  priorityPageId: string | null;
  staffPageIds: string[];
  relatedAccountPageIds: string[];
}): Promise<DetailLabelMaps> {
  const masterIds = [
    ...new Set([
      ...detail.businessCategoryPageIds,
      ...detail.tagPageIds,
      ...(detail.salesStatusPageId ? [detail.salesStatusPageId] : []),
      ...(detail.acquisitionRoutePageId ? [detail.acquisitionRoutePageId] : []),
      ...(detail.priorityPageId ? [detail.priorityPageId] : []),
    ]),
  ];
  const staffPageIds = [...new Set(detail.staffPageIds)];
  const relatedIds = [...new Set(detail.relatedAccountPageIds)];

  const admin = createAdminClient();
  const [mastersRes, staffRes, relatedRes] = await Promise.all([
    masterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name,is_active")
          .in("notion_page_id", masterIds),
    staffPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("notion_staff_page_id,display_name,is_active")
          .in("notion_staff_page_id", staffPageIds),
    relatedIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("customer_index")
          .select("notion_page_id,display_name,is_archived")
          .in("notion_page_id", relatedIds),
  ]);
  if (mastersRes.error) throw new Error(mastersRes.error.message);
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (relatedRes.error) throw new Error(relatedRes.error.message);

  const masters = (mastersRes.data ?? []) as {
    notion_page_id: string;
    name: string;
    is_active: boolean;
  }[];
  const staff = (staffRes.data ?? []) as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  }[];
  const related = (relatedRes.data ?? []) as {
    notion_page_id: string;
    display_name: string;
    is_archived: boolean;
  }[];

  return {
    masterNames: new Map(masters.map((m) => [m.notion_page_id, m.name])),
    staffNamesByPageId: new Map(
      staff.map((s) => [s.notion_staff_page_id, s.display_name]),
    ),
    relatedCustomers: new Map(
      related.map((c) => [
        c.notion_page_id,
        { displayName: c.display_name, isArchived: c.is_archived },
      ]),
    ),
    inactiveMasterIds: new Set(
      masters.filter((m) => !m.is_active).map((m) => m.notion_page_id),
    ),
    inactiveStaffPageIds: new Set(
      staff.filter((s) => !s.is_active).map((s) => s.notion_staff_page_id),
    ),
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [mastersRes, staffRes, prefRes] = await Promise.all([
    admin
      .from("masters_cache")
      .select("notion_page_id,master_type,name,sort_order")
      .in("master_type", ["営業ステータス", "事業区分"])
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("id,display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    admin.from("customer_index").select("prefecture").not("prefecture", "is", null),
  ]);
  if (mastersRes.error) throw new Error(mastersRes.error.message);
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (prefRes.error) throw new Error(prefRes.error.message);

  const masters = (mastersRes.data ?? []) as {
    notion_page_id: string;
    master_type: string;
    name: string;
  }[];
  const prefectures = [
    ...new Set(
      ((prefRes.data ?? []) as { prefecture: string | null }[])
        .map((r) => r.prefecture)
        .filter((p): p is string => Boolean(p)),
    ),
  ].sort();

  return {
    salesStatuses: masters
      .filter((m) => m.master_type === "営業ステータス")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    businessCategories: masters
      .filter((m) => m.master_type === "事業区分")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    staff: ((staffRes.data ?? []) as { id: string; display_name: string }[]).map(
      (u) => ({ userId: u.id, name: u.display_name }),
    ),
    prefectures,
  };
}

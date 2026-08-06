import "server-only";

import type { DealDetail, DealIndexRow } from "@/lib/deals/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 一覧表示用のラベル解決とフィルター選択肢。
 * deal_index行のID列を名称へ一括解決する。Notion APIは呼ばない。
 */

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  stageNames: Map<string, string>;
  statusNames: Map<string, string>;
  staffNamesByPageId: Map<string, string>;
  contactNames: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  stages: { pageId: string; name: string }[];
  statuses: { pageId: string; name: string }[];
  staff: { userId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  stageName: string | null;
  stageInactive: boolean;
  statusName: string | null;
  statusInactive: boolean;
  businessCategoryName: string | null;
  businessCategoryInactive: boolean;
  staffNames: { pageId: string; name: string; inactive: boolean }[];
  contactNames: { pageId: string; name: string }[];
};

function collectIds(rows: DealIndexRow[]) {
  const customerIds = new Set<string>();
  const masterIds = new Set<string>();
  const staffPageIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.stage_id) masterIds.add(row.stage_id);
    if (row.status_id) masterIds.add(row.status_id);
    if (row.business_category_id) masterIds.add(row.business_category_id);
    for (const id of row.staff_page_ids ?? []) staffPageIds.add(id);
    for (const id of row.contact_page_ids ?? []) contactIds.add(id);
  }
  return { customerIds, masterIds, staffPageIds, contactIds };
}

export async function loadListLabelMaps(
  rows: DealIndexRow[],
): Promise<ListLabelMaps> {
  const { customerIds, masterIds, staffPageIds, contactIds } =
    collectIds(rows);
  const admin = createAdminClient();

  const [customersRes, mastersRes, staffRes, contactsRes] = await Promise.all([
    customerIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("customer_index")
          .select("notion_page_id,display_name")
          .in("notion_page_id", [...customerIds]),
    masterIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name")
          .in("notion_page_id", [...masterIds]),
    staffPageIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("notion_staff_page_id,display_name")
          .in("notion_staff_page_id", [...staffPageIds]),
    contactIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("contact_index")
          .select("notion_page_id,name")
          .in("notion_page_id", [...contactIds]),
  ]);
  for (const r of [customersRes, mastersRes, staffRes, contactsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  return {
    customerNames: new Map(
      (
        (customersRes.data ?? []) as {
          notion_page_id: string;
          display_name: string;
        }[]
      ).map((c) => [c.notion_page_id, c.display_name]),
    ),
    stageNames: new Map(
      (
        (mastersRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((m) => [m.notion_page_id, m.name]),
    ),
    statusNames: new Map(
      (
        (mastersRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((m) => [m.notion_page_id, m.name]),
    ),
    staffNamesByPageId: new Map(
      (
        (staffRes.data ?? []) as {
          notion_staff_page_id: string;
          display_name: string;
        }[]
      ).map((s) => [s.notion_staff_page_id, s.display_name]),
    ),
    contactNames: new Map(
      (
        (contactsRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((c) => [c.notion_page_id, c.name]),
    ),
  };
}

export async function loadDetailLabelMaps(
  detail: DealDetail,
): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const masterIds = [
    detail.stagePageId,
    detail.statusPageId,
    detail.businessCategoryPageId,
  ].filter((id): id is string => Boolean(id));

  const [customerRes, mastersRes, staffRes, contactsRes] = await Promise.all([
    detail.customerPageId
      ? admin
          .from("customer_index")
          .select("display_name,is_archived")
          .eq("notion_page_id", detail.customerPageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    masterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name,is_active")
          .in("notion_page_id", masterIds),
    detail.staffPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("notion_staff_page_id,display_name,is_active")
          .in("notion_staff_page_id", detail.staffPageIds),
    detail.contactPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("contact_index")
          .select("notion_page_id,name")
          .in("notion_page_id", detail.contactPageIds),
  ]);
  for (const r of [customerRes, mastersRes, staffRes, contactsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const customer = customerRes.data as {
    display_name: string;
    is_archived: boolean;
  } | null;
  const masters = new Map(
    (
      (mastersRes.data ?? []) as {
        notion_page_id: string;
        name: string;
        is_active: boolean;
      }[]
    ).map((m) => [m.notion_page_id, m]),
  );
  const staffByPage = new Map(
    (
      (staffRes.data ?? []) as {
        notion_staff_page_id: string;
        display_name: string;
        is_active: boolean;
      }[]
    ).map((s) => [s.notion_staff_page_id, s]),
  );
  const contactByPage = new Map(
    (
      (contactsRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((c) => [c.notion_page_id, c.name]),
  );

  const stage = detail.stagePageId
    ? masters.get(detail.stagePageId)
    : undefined;
  const status = detail.statusPageId
    ? masters.get(detail.statusPageId)
    : undefined;
  const biz = detail.businessCategoryPageId
    ? masters.get(detail.businessCategoryPageId)
    : undefined;

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    stageName: stage?.name ?? null,
    stageInactive: stage ? !stage.is_active : false,
    statusName: status?.name ?? null,
    statusInactive: status ? !status.is_active : false,
    businessCategoryName: biz?.name ?? null,
    businessCategoryInactive: biz ? !biz.is_active : false,
    staffNames: detail.staffPageIds.map((pageId) => {
      const s = staffByPage.get(pageId);
      return {
        pageId,
        name: s?.display_name ?? "(不明)",
        inactive: s ? !s.is_active : false,
      };
    }),
    contactNames: detail.contactPageIds.map((pageId) => ({
      pageId,
      name: contactByPage.get(pageId) ?? "(不明)",
    })),
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [customersRes, stagesRes, statusesRes, staffRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name")
      .eq("is_archived", false)
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("masters_cache")
      .select("notion_page_id,name,sort_order")
      .eq("master_type", "案件ステージ")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("masters_cache")
      .select("notion_page_id,name,sort_order")
      .eq("master_type", "案件ステータス")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("id,display_name")
      .eq("is_active", true)
      .not("notion_staff_page_id", "is", null)
      .order("display_name", { ascending: true }),
  ]);
  for (const r of [customersRes, stagesRes, statusesRes, staffRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  return {
    customers: (
      (customersRes.data ?? []) as {
        notion_page_id: string;
        display_name: string;
      }[]
    ).map((c) => ({ pageId: c.notion_page_id, displayName: c.display_name })),
    stages: (
      (stagesRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    statuses: (
      (statusesRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    staff: (
      (staffRes.data ?? []) as { id: string; display_name: string }[]
    ).map((s) => ({ userId: s.id, name: s.display_name })),
  };
}

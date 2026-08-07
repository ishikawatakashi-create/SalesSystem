import "server-only";

import type { ComplaintDetail, ComplaintIndexRow } from "@/lib/complaints/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  dealTitles: Map<string, string>;
  severityNames: Map<string, string>;
  statusNames: Map<string, string>;
  staffNamesByPageId: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  severities: { pageId: string; name: string }[];
  statuses: { pageId: string; name: string }[];
  staff: { userId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  dealTitle: string | null;
  severityName: string | null;
  severityInactive: boolean;
  statusName: string | null;
  statusInactive: boolean;
  staffName: string | null;
  staffInactive: boolean;
};

function collectIds(rows: ComplaintIndexRow[]) {
  const customerIds = new Set<string>();
  const dealIds = new Set<string>();
  const masterIds = new Set<string>();
  const staffPageIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.deal_page_id) dealIds.add(row.deal_page_id);
    if (row.severity_id) masterIds.add(row.severity_id);
    if (row.status_id) masterIds.add(row.status_id);
    if (row.staff_page_id) staffPageIds.add(row.staff_page_id);
  }
  return { customerIds, dealIds, masterIds, staffPageIds };
}

export async function loadListLabelMaps(
  rows: ComplaintIndexRow[],
): Promise<ListLabelMaps> {
  const { customerIds, dealIds, masterIds, staffPageIds } = collectIds(rows);
  const admin = createAdminClient();

  const [customersRes, dealsRes, mastersRes, staffRes] = await Promise.all([
    customerIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("customer_index")
          .select("notion_page_id,display_name")
          .in("notion_page_id", [...customerIds]),
    dealIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("deal_index")
          .select("notion_page_id,title")
          .in("notion_page_id", [...dealIds]),
    masterIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name,master_type")
          .in("notion_page_id", [...masterIds]),
    staffPageIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("notion_staff_page_id,display_name")
          .in("notion_staff_page_id", [...staffPageIds]),
  ]);
  for (const r of [customersRes, dealsRes, mastersRes, staffRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const masters = (mastersRes.data ?? []) as {
    notion_page_id: string;
    name: string;
    master_type: string;
  }[];
  const allMasterNames = new Map(
    masters.map((m) => [m.notion_page_id, m.name]),
  );
  const byType = (type: string) => {
    const map = new Map(
      masters
        .filter((m) => m.master_type === type)
        .map((m) => [m.notion_page_id, m.name]),
    );
    for (const [id, name] of allMasterNames) {
      if (!map.has(id)) map.set(id, name);
    }
    return map;
  };

  return {
    customerNames: new Map(
      (
        (customersRes.data ?? []) as {
          notion_page_id: string;
          display_name: string;
        }[]
      ).map((c) => [c.notion_page_id, c.display_name]),
    ),
    dealTitles: new Map(
      (
        (dealsRes.data ?? []) as { notion_page_id: string; title: string }[]
      ).map((d) => [d.notion_page_id, d.title || "(無題)"]),
    ),
    severityNames: byType("クレーム重要度"),
    statusNames: byType("クレーム対応状況"),
    staffNamesByPageId: new Map(
      (
        (staffRes.data ?? []) as {
          notion_staff_page_id: string;
          display_name: string;
        }[]
      ).map((s) => [s.notion_staff_page_id, s.display_name]),
    ),
  };
}

export async function loadDetailLabelMaps(
  detail: ComplaintDetail,
): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const masterIds = [detail.severityPageId, detail.statusPageId].filter(
    (id): id is string => Boolean(id),
  );

  const [customerRes, dealRes, mastersRes, staffRes] = await Promise.all([
    detail.customerPageId
      ? admin
          .from("customer_index")
          .select("display_name,is_archived")
          .eq("notion_page_id", detail.customerPageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    detail.dealPageId
      ? admin
          .from("deal_index")
          .select("title")
          .eq("notion_page_id", detail.dealPageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    masterIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name,is_active")
          .in("notion_page_id", masterIds),
    detail.staffPageId
      ? admin
          .from("app_users")
          .select("display_name,is_active")
          .eq("notion_staff_page_id", detail.staffPageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [customerRes, dealRes, mastersRes, staffRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const customer = customerRes.data as {
    display_name: string;
    is_archived: boolean;
  } | null;
  const deal = dealRes.data as { title: string } | null;
  const masters = new Map(
    (
      (mastersRes.data ?? []) as {
        notion_page_id: string;
        name: string;
        is_active: boolean;
      }[]
    ).map((m) => [m.notion_page_id, m]),
  );
  const staff = staffRes.data as {
    display_name: string;
    is_active: boolean;
  } | null;

  const severity = detail.severityPageId
    ? masters.get(detail.severityPageId)
    : null;
  const status = detail.statusPageId
    ? masters.get(detail.statusPageId)
    : null;

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    dealTitle: deal?.title ?? null,
    severityName: severity?.name ?? (detail.severityPageId ? "(不明)" : null),
    severityInactive: severity ? !severity.is_active : false,
    statusName: status?.name ?? (detail.statusPageId ? "(不明)" : null),
    statusInactive: status ? !status.is_active : false,
    staffName: staff?.display_name ?? (detail.staffPageId ? "(不明)" : null),
    staffInactive: staff ? !staff.is_active : false,
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [customersRes, mastersRes, usersRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name")
      .eq("is_archived", false)
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("masters_cache")
      .select("notion_page_id,name,master_type,sort_order")
      .in("master_type", ["クレーム重要度", "クレーム対応状況"])
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false }),
    admin
      .from("app_users")
      .select("id,display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
  ]);
  for (const r of [customersRes, mastersRes, usersRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const masters = (mastersRes.data ?? []) as {
    notion_page_id: string;
    name: string;
    master_type: string;
  }[];

  return {
    customers: (
      (customersRes.data ?? []) as {
        notion_page_id: string;
        display_name: string;
      }[]
    ).map((c) => ({ pageId: c.notion_page_id, displayName: c.display_name })),
    severities: masters
      .filter((m) => m.master_type === "クレーム重要度")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    statuses: masters
      .filter((m) => m.master_type === "クレーム対応状況")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    staff: (
      (usersRes.data ?? []) as { id: string; display_name: string }[]
    ).map((u) => ({ userId: u.id, name: u.display_name })),
  };
}

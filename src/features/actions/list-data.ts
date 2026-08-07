import "server-only";

import type { ActionDetail, ActionIndexRow } from "@/lib/actions/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  dealTitles: Map<string, string>;
  statusNames: Map<string, string>;
  priorityNames: Map<string, string>;
  staffNamesByPageId: Map<string, string>;
  assigneeNames: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  deals: { pageId: string; title: string }[];
  statuses: { pageId: string; name: string }[];
  assignees: { userId: string; name: string }[];
  staff: { pageId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  dealTitle: string | null;
  activityTitle: string | null;
  statusName: string | null;
  statusInactive: boolean;
  statusSemantic: string | null;
  priorityName: string | null;
  priorityInactive: boolean;
  staffName: string | null;
  staffInactive: boolean;
};

function collectIds(rows: ActionIndexRow[]) {
  const customerIds = new Set<string>();
  const dealIds = new Set<string>();
  const masterIds = new Set<string>();
  const staffPageIds = new Set<string>();
  const assigneeIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.deal_page_id) dealIds.add(row.deal_page_id);
    if (row.status_id) masterIds.add(row.status_id);
    if (row.priority_id) masterIds.add(row.priority_id);
    if (row.staff_page_id) staffPageIds.add(row.staff_page_id);
    if (row.assignee_user_id) assigneeIds.add(row.assignee_user_id);
  }
  return { customerIds, dealIds, masterIds, staffPageIds, assigneeIds };
}

export async function loadListLabelMaps(
  rows: ActionIndexRow[],
): Promise<ListLabelMaps> {
  const { customerIds, dealIds, masterIds, staffPageIds, assigneeIds } =
    collectIds(rows);
  const admin = createAdminClient();

  const [customersRes, dealsRes, mastersRes, staffRes, assigneesRes] =
    await Promise.all([
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
            .select("notion_page_id,name")
            .in("notion_page_id", [...masterIds]),
      staffPageIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("app_users")
            .select("notion_staff_page_id,display_name")
            .in("notion_staff_page_id", [...staffPageIds]),
      assigneeIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("app_users")
            .select("id,display_name")
            .in("id", [...assigneeIds]),
    ]);
  for (const r of [
    customersRes,
    dealsRes,
    mastersRes,
    staffRes,
    assigneesRes,
  ]) {
    if (r.error) throw new Error(r.error.message);
  }

  const masterNames = new Map(
    (
      (mastersRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => [m.notion_page_id, m.name]),
  );

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
    statusNames: masterNames,
    priorityNames: masterNames,
    staffNamesByPageId: new Map(
      (
        (staffRes.data ?? []) as {
          notion_staff_page_id: string;
          display_name: string;
        }[]
      ).map((s) => [s.notion_staff_page_id, s.display_name]),
    ),
    assigneeNames: new Map(
      (
        (assigneesRes.data ?? []) as { id: string; display_name: string }[]
      ).map((u) => [u.id, u.display_name]),
    ),
  };
}

export async function loadDetailLabelMaps(
  detail: ActionDetail,
): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const masterIds = [detail.statusPageId, detail.priorityPageId].filter(
    (id): id is string => Boolean(id),
  );

  const [customerRes, dealRes, activityRes, mastersRes, staffRes] =
    await Promise.all([
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
      detail.activityPageId
        ? admin
            .from("activity_index")
            .select("title")
            .eq("notion_page_id", detail.activityPageId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      masterIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("masters_cache")
            .select("notion_page_id,name,is_active,semantic_key")
            .in("notion_page_id", masterIds),
      detail.staffPageId
        ? admin
            .from("app_users")
            .select("notion_staff_page_id,display_name,is_active")
            .eq("notion_staff_page_id", detail.staffPageId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  for (const r of [
    customerRes,
    dealRes,
    activityRes,
    mastersRes,
    staffRes,
  ]) {
    if (r.error) throw new Error(r.error.message);
  }

  const customer = customerRes.data as {
    display_name: string;
    is_archived: boolean;
  } | null;
  const deal = dealRes.data as { title: string } | null;
  const activity = activityRes.data as { title: string } | null;
  const masters = new Map(
    (
      (mastersRes.data ?? []) as {
        notion_page_id: string;
        name: string;
        is_active: boolean;
        semantic_key: string | null;
      }[]
    ).map((m) => [m.notion_page_id, m]),
  );
  const staff = staffRes.data as {
    notion_staff_page_id: string;
    display_name: string;
    is_active: boolean;
  } | null;

  const status = detail.statusPageId
    ? masters.get(detail.statusPageId)
    : undefined;
  const priority = detail.priorityPageId
    ? masters.get(detail.priorityPageId)
    : undefined;

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    dealTitle: deal?.title ?? null,
    activityTitle: activity?.title ?? null,
    statusName: status?.name ?? null,
    statusInactive: status ? !status.is_active : false,
    statusSemantic: status?.semantic_key ?? null,
    priorityName: priority?.name ?? null,
    priorityInactive: priority ? !priority.is_active : false,
    staffName: staff?.display_name ?? null,
    staffInactive: staff ? !staff.is_active : false,
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [customersRes, dealsRes, statusesRes, assigneesRes, staffRes] =
    await Promise.all([
      admin
        .from("customer_index")
        .select("notion_page_id,display_name")
        .eq("is_archived", false)
        .order("display_name", { ascending: true })
        .limit(500),
      admin
        .from("deal_index")
        .select("notion_page_id,title")
        .order("title", { ascending: true })
        .limit(500),
      admin
        .from("masters_cache")
        .select("notion_page_id,name,sort_order")
        .eq("master_type", "アクション状態")
        .eq("is_active", true)
        .order("sort_order", { ascending: true, nullsFirst: false }),
      admin
        .from("app_users")
        .select("id,display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      admin
        .from("app_users")
        .select("notion_staff_page_id,display_name")
        .eq("is_active", true)
        .not("notion_staff_page_id", "is", null)
        .order("display_name", { ascending: true }),
    ]);
  for (const r of [
    customersRes,
    dealsRes,
    statusesRes,
    assigneesRes,
    staffRes,
  ]) {
    if (r.error) throw new Error(r.error.message);
  }

  return {
    customers: (
      (customersRes.data ?? []) as {
        notion_page_id: string;
        display_name: string;
      }[]
    ).map((c) => ({ pageId: c.notion_page_id, displayName: c.display_name })),
    deals: (
      (dealsRes.data ?? []) as { notion_page_id: string; title: string }[]
    ).map((d) => ({
      pageId: d.notion_page_id,
      title: d.title || "(無題)",
    })),
    statuses: (
      (statusesRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    assignees: (
      (assigneesRes.data ?? []) as { id: string; display_name: string }[]
    ).map((u) => ({ userId: u.id, name: u.display_name })),
    staff: (
      (staffRes.data ?? []) as {
        notion_staff_page_id: string;
        display_name: string;
      }[]
    ).map((s) => ({
      pageId: s.notion_staff_page_id,
      name: s.display_name,
    })),
  };
}

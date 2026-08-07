import "server-only";

import type { ContractDetail, ContractIndexRow } from "@/lib/contracts/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  dealTitles: Map<string, string>;
  tradeTypeNames: Map<string, string>;
  contractTypeNames: Map<string, string>;
  statusNames: Map<string, string>;
  paymentStatusNames: Map<string, string>;
  staffNamesByPageId: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  tradeTypes: { pageId: string; name: string }[];
  statuses: { pageId: string; name: string }[];
  paymentStatuses: { pageId: string; name: string }[];
  staff: { userId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  dealTitle: string | null;
  contractTypeName: string | null;
  contractTypeInactive: boolean;
  tradeTypeName: string | null;
  tradeTypeInactive: boolean;
  paymentStatusName: string | null;
  paymentStatusInactive: boolean;
  statusName: string | null;
  statusInactive: boolean;
  staffNames: { pageId: string; name: string; inactive: boolean }[];
};

function collectIds(rows: ContractIndexRow[]) {
  const customerIds = new Set<string>();
  const dealIds = new Set<string>();
  const masterIds = new Set<string>();
  const staffPageIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.deal_page_id) dealIds.add(row.deal_page_id);
    if (row.contract_type_id) masterIds.add(row.contract_type_id);
    if (row.trade_type_id) masterIds.add(row.trade_type_id);
    if (row.status_id) masterIds.add(row.status_id);
    if (row.payment_status_id) masterIds.add(row.payment_status_id);
    for (const id of row.staff_page_ids ?? []) staffPageIds.add(id);
  }
  return { customerIds, dealIds, masterIds, staffPageIds };
}

export async function loadListLabelMaps(
  rows: ContractIndexRow[],
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
  const byType = (type: string) =>
    new Map(
      masters
        .filter((m) => m.master_type === type)
        .map((m) => [m.notion_page_id, m.name]),
    );
  // master_type 不一致時も名称表示できるよう全件マップでフォールバック
  const allMasterNames = new Map(
    masters.map((m) => [m.notion_page_id, m.name]),
  );
  const withFallback = (typed: Map<string, string>) => {
    for (const [id, name] of allMasterNames) {
      if (!typed.has(id)) typed.set(id, name);
    }
    return typed;
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
    tradeTypeNames: withFallback(byType("取引区分")),
    contractTypeNames: withFallback(byType("契約区分")),
    statusNames: withFallback(byType("契約状態")),
    paymentStatusNames: withFallback(byType("支払状況")),
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
  detail: ContractDetail,
): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const masterIds = [
    detail.contractTypePageId,
    detail.tradeTypePageId,
    detail.paymentStatusPageId,
    detail.statusPageId,
  ].filter((id): id is string => Boolean(id));

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
          .select("notion_page_id,name,is_active,master_type")
          .in("notion_page_id", masterIds),
    detail.staffPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("app_users")
          .select("notion_staff_page_id,display_name,is_active")
          .in("notion_staff_page_id", detail.staffPageIds),
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
        master_type: string;
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

  const masterMeta = (id: string | null) => {
    if (!id) return { name: null, inactive: false };
    const m = masters.get(id);
    return {
      name: m?.name ?? "(不明)",
      inactive: m ? !m.is_active : false,
    };
  };

  const contractType = masterMeta(detail.contractTypePageId);
  const tradeType = masterMeta(detail.tradeTypePageId);
  const payment = masterMeta(detail.paymentStatusPageId);
  const status = masterMeta(detail.statusPageId);

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    dealTitle: deal?.title ?? null,
    contractTypeName: contractType.name,
    contractTypeInactive: contractType.inactive,
    tradeTypeName: tradeType.name,
    tradeTypeInactive: tradeType.inactive,
    paymentStatusName: payment.name,
    paymentStatusInactive: payment.inactive,
    statusName: status.name,
    statusInactive: status.inactive,
    staffNames: detail.staffPageIds.map((pageId) => {
      const s = staffByPage.get(pageId);
      return {
        pageId,
        name: s?.display_name ?? "(不明)",
        inactive: s ? !s.is_active : false,
      };
    }),
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
      .in("master_type", ["取引区分", "契約状態", "支払状況"])
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
    tradeTypes: masters
      .filter((m) => m.master_type === "取引区分")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    statuses: masters
      .filter((m) => m.master_type === "契約状態")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    paymentStatuses: masters
      .filter((m) => m.master_type === "支払状況")
      .map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    staff: (
      (usersRes.data ?? []) as { id: string; display_name: string }[]
    ).map((u) => ({ userId: u.id, name: u.display_name })),
  };
}

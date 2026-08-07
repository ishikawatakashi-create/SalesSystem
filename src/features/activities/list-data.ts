import "server-only";

import type {
  ActivityDetail,
  ActivityIndexRow,
} from "@/lib/activities/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  dealTitles: Map<string, string>;
  contactNames: Map<string, string>;
  categoryNames: Map<string, string>;
  createdByNames: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  contacts: { pageId: string; name: string }[];
  deals: { pageId: string; title: string }[];
  categories: { pageId: string; name: string }[];
  createdByUsers: { userId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  dealTitle: string | null;
  contactNames: { pageId: string; name: string }[];
  categoryNames: { pageId: string; name: string; inactive: boolean }[];
};

function collectIds(rows: ActivityIndexRow[]) {
  const customerIds = new Set<string>();
  const dealIds = new Set<string>();
  const contactIds = new Set<string>();
  const categoryIds = new Set<string>();
  const createdByIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.deal_page_id) dealIds.add(row.deal_page_id);
    for (const id of row.contact_page_ids ?? []) contactIds.add(id);
    for (const id of row.category_ids ?? []) categoryIds.add(id);
    if (row.created_by) createdByIds.add(row.created_by);
  }
  return { customerIds, dealIds, contactIds, categoryIds, createdByIds };
}

export async function loadListLabelMaps(
  rows: ActivityIndexRow[],
): Promise<ListLabelMaps> {
  const { customerIds, dealIds, contactIds, categoryIds, createdByIds } =
    collectIds(rows);
  const admin = createAdminClient();

  const [customersRes, dealsRes, contactsRes, mastersRes, usersRes] =
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
      contactIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("contact_index")
            .select("notion_page_id,name")
            .in("notion_page_id", [...contactIds]),
      categoryIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("masters_cache")
            .select("notion_page_id,name")
            .in("notion_page_id", [...categoryIds]),
      createdByIds.size === 0
        ? Promise.resolve({ data: [], error: null })
        : admin
            .from("app_users")
            .select("id,display_name")
            .in("id", [...createdByIds]),
    ]);
  for (const r of [
    customersRes,
    dealsRes,
    contactsRes,
    mastersRes,
    usersRes,
  ]) {
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
    dealTitles: new Map(
      (
        (dealsRes.data ?? []) as { notion_page_id: string; title: string }[]
      ).map((d) => [d.notion_page_id, d.title || "(無題)"]),
    ),
    contactNames: new Map(
      (
        (contactsRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((c) => [c.notion_page_id, c.name]),
    ),
    categoryNames: new Map(
      (
        (mastersRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((m) => [m.notion_page_id, m.name]),
    ),
    createdByNames: new Map(
      (
        (usersRes.data ?? []) as { id: string; display_name: string }[]
      ).map((u) => [u.id, u.display_name]),
    ),
  };
}

export async function loadDetailLabelMaps(
  detail: ActivityDetail,
): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const [customerRes, dealRes, contactsRes, mastersRes] = await Promise.all([
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
    detail.contactPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("contact_index")
          .select("notion_page_id,name")
          .in("notion_page_id", detail.contactPageIds),
    detail.categoryPageIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name,is_active")
          .in("notion_page_id", detail.categoryPageIds),
  ]);
  for (const r of [customerRes, dealRes, contactsRes, mastersRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const customer = customerRes.data as {
    display_name: string;
    is_archived: boolean;
  } | null;
  const deal = dealRes.data as { title: string } | null;
  const contactByPage = new Map(
    (
      (contactsRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((c) => [c.notion_page_id, c.name]),
  );
  const masters = new Map(
    (
      (mastersRes.data ?? []) as {
        notion_page_id: string;
        name: string;
        is_active: boolean;
      }[]
    ).map((m) => [m.notion_page_id, m]),
  );

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    dealTitle: deal?.title ?? null,
    contactNames: detail.contactPageIds.map((pageId) => ({
      pageId,
      name: contactByPage.get(pageId) ?? "(不明)",
    })),
    categoryNames: detail.categoryPageIds.map((pageId) => {
      const m = masters.get(pageId);
      return {
        pageId,
        name: m?.name ?? "(不明)",
        inactive: m ? !m.is_active : false,
      };
    }),
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [customersRes, contactsRes, dealsRes, categoriesRes, usersRes] =
    await Promise.all([
      admin
        .from("customer_index")
        .select("notion_page_id,display_name")
        .eq("is_archived", false)
        .order("display_name", { ascending: true })
        .limit(500),
      admin
        .from("contact_index")
        .select("notion_page_id,name")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(500),
      admin
        .from("deal_index")
        .select("notion_page_id,title")
        .order("title", { ascending: true })
        .limit(500),
      admin
        .from("masters_cache")
        .select("notion_page_id,name,sort_order")
        .eq("master_type", "対応履歴分類")
        .eq("is_active", true)
        .order("sort_order", { ascending: true, nullsFirst: false }),
      admin
        .from("app_users")
        .select("id,display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
    ]);
  for (const r of [
    customersRes,
    contactsRes,
    dealsRes,
    categoriesRes,
    usersRes,
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
    contacts: (
      (contactsRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((c) => ({ pageId: c.notion_page_id, name: c.name })),
    deals: (
      (dealsRes.data ?? []) as { notion_page_id: string; title: string }[]
    ).map((d) => ({
      pageId: d.notion_page_id,
      title: d.title || "(無題)",
    })),
    categories: (
      (categoriesRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => ({ pageId: m.notion_page_id, name: m.name })),
    createdByUsers: (
      (usersRes.data ?? []) as { id: string; display_name: string }[]
    ).map((u) => ({ userId: u.id, name: u.display_name })),
  };
}

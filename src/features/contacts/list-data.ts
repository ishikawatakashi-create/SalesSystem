import "server-only";

import type { ContactIndexRow } from "@/lib/contacts/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 一覧表示用のラベル解決とフィルター選択肢。
 * contact_index行のID列を名称へ一括解決する。Notion APIは呼ばない。
 * 呼出元でrequireUser/requirePermission済みであること。
 */

export type ListLabelMaps = {
  customerNames: Map<string, string>;
  contactTypeNames: Map<string, string>;
};

export type ListFilterOptions = {
  customers: { pageId: string; displayName: string }[];
  contactTypes: { pageId: string; name: string }[];
};

export type DetailLabelMaps = {
  customerName: string | null;
  customerArchived: boolean;
  contactTypeName: string | null;
  contactTypeInactive: boolean;
};

export async function loadListLabelMaps(
  rows: ContactIndexRow[],
): Promise<ListLabelMaps> {
  const customerIds = new Set<string>();
  const typeIds = new Set<string>();
  for (const row of rows) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
    if (row.contact_type_id) typeIds.add(row.contact_type_id);
  }

  const admin = createAdminClient();
  const [customersRes, typesRes] = await Promise.all([
    customerIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("customer_index")
          .select("notion_page_id,display_name")
          .in("notion_page_id", [...customerIds]),
    typeIds.size === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("masters_cache")
          .select("notion_page_id,name")
          .in("notion_page_id", [...typeIds]),
  ]);
  if (customersRes.error) throw new Error(customersRes.error.message);
  if (typesRes.error) throw new Error(typesRes.error.message);

  return {
    customerNames: new Map(
      (
        (customersRes.data ?? []) as {
          notion_page_id: string;
          display_name: string;
        }[]
      ).map((c) => [c.notion_page_id, c.display_name]),
    ),
    contactTypeNames: new Map(
      (
        (typesRes.data ?? []) as { notion_page_id: string; name: string }[]
      ).map((m) => [m.notion_page_id, m.name]),
    ),
  };
}

export async function loadDetailLabelMaps(detail: {
  customerPageId: string | null;
  contactTypePageId: string | null;
}): Promise<DetailLabelMaps> {
  const admin = createAdminClient();
  const [customerRes, typeRes] = await Promise.all([
    detail.customerPageId
      ? admin
          .from("customer_index")
          .select("display_name,is_archived")
          .eq("notion_page_id", detail.customerPageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    detail.contactTypePageId
      ? admin
          .from("masters_cache")
          .select("name,is_active")
          .eq("notion_page_id", detail.contactTypePageId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (customerRes.error) throw new Error(customerRes.error.message);
  if (typeRes.error) throw new Error(typeRes.error.message);

  const customer = customerRes.data as {
    display_name: string;
    is_archived: boolean;
  } | null;
  const type = typeRes.data as { name: string; is_active: boolean } | null;

  return {
    customerName: customer?.display_name ?? null,
    customerArchived: customer?.is_archived ?? false,
    contactTypeName: type?.name ?? null,
    contactTypeInactive: type ? !type.is_active : false,
  };
}

export async function loadListFilterOptions(): Promise<ListFilterOptions> {
  const admin = createAdminClient();
  const [customersRes, typesRes] = await Promise.all([
    admin
      .from("customer_index")
      .select("notion_page_id,display_name")
      .eq("is_archived", false)
      .order("display_name", { ascending: true })
      .limit(500),
    admin
      .from("masters_cache")
      .select("notion_page_id,name,sort_order")
      .eq("master_type", "担当者区分")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false }),
  ]);
  if (customersRes.error) throw new Error(customersRes.error.message);
  if (typesRes.error) throw new Error(typesRes.error.message);

  return {
    customers: (
      (customersRes.data ?? []) as {
        notion_page_id: string;
        display_name: string;
      }[]
    ).map((c) => ({ pageId: c.notion_page_id, displayName: c.display_name })),
    contactTypes: (
      (typesRes.data ?? []) as { notion_page_id: string; name: string }[]
    ).map((m) => ({ pageId: m.notion_page_id, name: m.name })),
  };
}

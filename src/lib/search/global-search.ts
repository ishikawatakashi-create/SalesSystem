import "server-only";

import { requirePermission, requireUser } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { toIlikePattern } from "@/lib/search/escape";
import {
  SEARCH_ENTITIES,
  SEARCH_ENTITY_LABELS,
  type GlobalSearchHit,
  type GlobalSearchResult,
  type SearchEntity,
} from "@/lib/search/types";

const EMPTY: GlobalSearchResult = {
  q: "",
  limitPerEntity: 5,
  groups: SEARCH_ENTITIES.map((entity) => ({
    entity,
    label: SEARCH_ENTITY_LABELS[entity],
    hits: [],
  })),
  totalCount: 0,
};

/**
 * 全体検索(インデックスのみ / Notion API なし / RLS)。
 * customer.view が必要。limitPerEntity 既定5(ドロップダウン)、最大20。
 */
export async function globalSearch(
  q: string,
  options?: { limitPerEntity?: number },
): Promise<GlobalSearchResult> {
  const user = await requireUser();
  requirePermission(user, "customer.view");

  const trimmed = q.trim();
  if (trimmed.length < 1) {
    return { ...EMPTY, q: trimmed };
  }

  const pattern = toIlikePattern(trimmed);
  if (!pattern) {
    return { ...EMPTY, q: trimmed };
  }
  // PostgREST .or() 用に値を二重引用符で包む(空白対策)
  const p = `"${pattern}"`;

  const limitPerEntity = Math.min(
    Math.max(options?.limitPerEntity ?? 5, 1),
    20,
  );
  const supabase = await createClient();

  const [
    customersRes,
    contactsRes,
    dealsRes,
    activitiesRes,
    actionsRes,
    contractsRes,
    complaintsRes,
  ] = await Promise.all([
    supabase
      .from("customer_index")
      .select(
        "notion_page_id,display_name,legal_name,phone,email,is_archived,relationship_semantic_keys",
      )
      .or(
        [
          `search_text.ilike.${p}`,
          `search_text_kana.ilike.${p}`,
          `display_name.ilike.${p}`,
          `legal_name.ilike.${p}`,
          `phone.ilike.${p}`,
          `email.ilike.${p}`,
        ].join(","),
      )
      .order("is_archived", { ascending: true })
      .order("display_name", { ascending: true })
      .limit(limitPerEntity),
    supabase
      .from("contact_index")
      .select("notion_page_id,name,name_kana,phone,email,customer_page_id")
      .or(
        [
          `search_text.ilike.${p}`,
          `name.ilike.${p}`,
          `name_kana.ilike.${p}`,
          `phone.ilike.${p}`,
          `email.ilike.${p}`,
        ].join(","),
      )
      .order("name", { ascending: true })
      .limit(limitPerEntity),
    supabase
      .from("deal_index")
      .select("notion_page_id,title,customer_page_id,status_semantic")
      .or(`search_text.ilike.${p},title.ilike.${p}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerEntity),
    supabase
      .from("activity_index")
      .select("notion_page_id,title,summary,customer_page_id,activity_at")
      .or(`search_text.ilike.${p},title.ilike.${p},summary.ilike.${p}`)
      .order("activity_at", { ascending: false, nullsFirst: false })
      .limit(limitPerEntity),
    supabase
      .from("action_index")
      .select("notion_page_id,title,customer_page_id,due_date,is_open")
      .or(`search_text.ilike.${p},title.ilike.${p}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limitPerEntity),
    supabase
      .from("contract_index")
      .select("notion_page_id,title,customer_page_id,status_semantic")
      .or(`search_text.ilike.${p},title.ilike.${p}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerEntity),
    supabase
      .from("complaint_index")
      .select("notion_page_id,title,summary,customer_page_id,status_semantic")
      .or(`search_text.ilike.${p},title.ilike.${p},summary.ilike.${p}`)
      .order("updated_at", { ascending: false })
      .limit(limitPerEntity),
  ]);

  // 顧客名をサブタイトル用に一括取得
  const customerIds = new Set<string>();
  for (const row of (contactsRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }
  for (const row of (dealsRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }
  for (const row of (activitiesRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }
  for (const row of (actionsRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }
  for (const row of (contractsRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }
  for (const row of (complaintsRes.data ?? []) as Array<{
    customer_page_id: string | null;
  }>) {
    if (row.customer_page_id) customerIds.add(row.customer_page_id);
  }

  const customerNames = new Map<string, string>();
  if (customerIds.size > 0) {
    const { data } = await supabase
      .from("customer_index")
      .select("notion_page_id,display_name")
      .in("notion_page_id", [...customerIds]);
    for (const c of (data ?? []) as Array<{
      notion_page_id: string;
      display_name: string;
    }>) {
      customerNames.set(c.notion_page_id, c.display_name);
    }
  }

  const groups: GlobalSearchResult["groups"] = [];

  const pushGroup = (entity: SearchEntity, hits: GlobalSearchHit[]) => {
    groups.push({
      entity,
      label: SEARCH_ENTITY_LABELS[entity],
      hits,
    });
  };

  pushGroup(
    "customers",
    (
      (customersRes.data ?? []) as Array<{
        notion_page_id: string;
        display_name: string;
        legal_name: string | null;
        phone: string | null;
        email: string | null;
        is_archived: boolean;
        relationship_semantic_keys: string[] | null;
      }>
    ).map((r) => ({
      entity: "customers" as const,
      pageId: r.notion_page_id,
      title: r.display_name || "(無題)",
      subtitle: [r.legal_name, r.phone, r.email].filter(Boolean).join(" / ") || null,
      href: `/organizations/${r.notion_page_id}`,
      isArchived: r.is_archived,
      relationshipSemanticKeys: r.relationship_semantic_keys ?? [],
    })),
  );

  pushGroup(
    "contacts",
    (
      (contactsRes.data ?? []) as Array<{
        notion_page_id: string;
        name: string;
        name_kana: string | null;
        phone: string | null;
        email: string | null;
        customer_page_id: string | null;
      }>
    ).map((r) => ({
      entity: "contacts" as const,
      pageId: r.notion_page_id,
      title: r.name || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.name_kana,
          r.phone,
          r.email,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/contacts/${r.notion_page_id}`,
    })),
  );

  pushGroup(
    "deals",
    (
      (dealsRes.data ?? []) as Array<{
        notion_page_id: string;
        title: string;
        customer_page_id: string | null;
        status_semantic: string | null;
      }>
    ).map((r) => ({
      entity: "deals" as const,
      pageId: r.notion_page_id,
      title: r.title || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.status_semantic,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/deals/${r.notion_page_id}`,
    })),
  );

  pushGroup(
    "activities",
    (
      (activitiesRes.data ?? []) as Array<{
        notion_page_id: string;
        title: string;
        summary: string | null;
        customer_page_id: string | null;
      }>
    ).map((r) => ({
      entity: "activities" as const,
      pageId: r.notion_page_id,
      title: r.title || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.summary,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/activities/${r.notion_page_id}`,
    })),
  );

  pushGroup(
    "actions",
    (
      (actionsRes.data ?? []) as Array<{
        notion_page_id: string;
        title: string;
        customer_page_id: string | null;
        due_date: string | null;
        is_open: boolean;
      }>
    ).map((r) => ({
      entity: "actions" as const,
      pageId: r.notion_page_id,
      title: r.title || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.due_date,
          r.is_open ? "未完了" : null,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/actions/${r.notion_page_id}`,
    })),
  );

  pushGroup(
    "contracts",
    (
      (contractsRes.data ?? []) as Array<{
        notion_page_id: string;
        title: string;
        customer_page_id: string | null;
        status_semantic: string | null;
      }>
    ).map((r) => ({
      entity: "contracts" as const,
      pageId: r.notion_page_id,
      title: r.title || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.status_semantic,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/contracts/${r.notion_page_id}`,
    })),
  );

  pushGroup(
    "complaints",
    (
      (complaintsRes.data ?? []) as Array<{
        notion_page_id: string;
        title: string;
        summary: string | null;
        customer_page_id: string | null;
        status_semantic: string | null;
      }>
    ).map((r) => ({
      entity: "complaints" as const,
      pageId: r.notion_page_id,
      title: r.title || "(無題)",
      subtitle:
        [
          r.customer_page_id
            ? customerNames.get(r.customer_page_id)
            : null,
          r.status_semantic,
          r.summary,
        ]
          .filter(Boolean)
          .join(" / ") || null,
      href: `/complaints/${r.notion_page_id}`,
    })),
  );

  const totalCount = groups.reduce((n, g) => n + g.hits.length, 0);
  return {
    q: trimmed,
    limitPerEntity,
    groups,
    totalCount,
  };
}

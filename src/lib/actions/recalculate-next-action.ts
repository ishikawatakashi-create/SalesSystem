import "server-only";

import type { Client } from "@notionhq/client";

import { hashCustomerDomain } from "@/lib/customers/content-hash";
import { hashDealDomain } from "@/lib/deals/content-hash";
import {
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import { notionPageToDeal } from "@/lib/notion/converters/deal";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type NextActionSelection = {
  title: string | null;
  dueDate: string | null;
  actionPageId: string | null;
};

export type RecalculateNextActionResult = {
  targetType: "customer" | "deal";
  targetPageId: string;
  before: { title: string | null; dueDate: string | null };
  after: NextActionSelection;
};

/**
 * 未完了(is_open)のうち min(due_date), 同値なら notion_page_id asc。
 * 0件 → null(空文字にしない)。
 */
export function selectNextOpenAction(
  rows: Array<{
    notion_page_id: string;
    title: string;
    due_date: string | null;
    is_open: boolean;
  }>,
): NextActionSelection {
  const open = rows.filter((r) => r.is_open);
  if (open.length === 0) {
    return { title: null, dueDate: null, actionPageId: null };
  }
  const sorted = [...open].sort((a, b) => {
    const dA = a.due_date ?? "9999-12-31";
    const dB = b.due_date ?? "9999-12-31";
    if (dA !== dB) return dA.localeCompare(dB);
    return a.notion_page_id.localeCompare(b.notion_page_id);
  });
  const top = sorted[0]!;
  return {
    title: top.title || null,
    dueDate: top.due_date ?? null,
    actionPageId: top.notion_page_id,
  };
}

async function loadSchemaMaps(admin: AdminClient): Promise<{
  customers: PropertyIdMap;
  deals: PropertyIdMap;
}> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value as {
    databases?: {
      customers?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
      deals?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;

  const toMap = (
    props: Record<string, { id: string; name: string; type: string }> | undefined,
    label: string,
  ): PropertyIdMap => {
    if (!props) {
      throw new Error(`notion_schema_snapshot に ${label} プロパティがありません`);
    }
    const map: PropertyIdMap = {};
    for (const [name, meta] of Object.entries(props)) {
      map[name] = { id: meta.id, type: meta.type };
    }
    return map;
  };

  return {
    customers: toMap(value?.databases?.customers?.properties, "customers"),
    deals: toMap(value?.databases?.deals?.properties, "deals"),
  };
}

function nextActionNotionPatch(
  propertiesByName: PropertyIdMap,
  after: NextActionSelection,
): Record<string, unknown> {
  const titleProp = propertiesByName["次回アクション"];
  const dateProp = propertiesByName["次回予定日"];
  if (!titleProp || !dateProp) {
    throw new Error("次回アクション/次回予定日プロパティがありません");
  }
  return {
    [titleProp.id]: {
      rich_text: after.title ? [{ text: { content: after.title } }] : [],
    },
    [dateProp.id]: {
      date: after.dueDate ? { start: after.dueDate } : null,
    },
  };
}

/**
 * 顧客.次回アクション / 次回予定日 の system-only 再計算。
 */
export async function recalculateCustomerNextAction(input: {
  customerPageId: string;
  sourceActionExternalId?: string | null;
  jobId?: string | null;
  notion?: Client;
  admin?: AdminClient;
  propertiesByName?: PropertyIdMap;
}): Promise<RecalculateNextActionResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const propertiesByName =
    input.propertiesByName ??
    (await loadSchemaMaps(admin)).customers;

  const { data: actions, error: actError } = await admin
    .from("action_index")
    .select("notion_page_id,title,due_date,is_open")
    .eq("customer_page_id", input.customerPageId);
  if (actError) throw new Error(actError.message);

  const after = selectNextOpenAction(
    (actions ?? []) as Array<{
      notion_page_id: string;
      title: string;
      due_date: string | null;
      is_open: boolean;
    }>,
  );

  const { data: indexRow, error: indexError } = await admin
    .from("customer_index")
    .select("next_action,next_action_date")
    .eq("notion_page_id", input.customerPageId)
    .maybeSingle();
  if (indexError) throw new Error(indexError.message);
  if (!indexRow) {
    throw new Error("customer_index に対象顧客がありません");
  }

  const page = await notion.pages.retrieve({
    page_id: input.customerPageId,
  });
  const beforeCustomer = await notionPageToCustomer({
    page: page as never,
    propertiesByName,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const before = {
    title: beforeCustomer.nextAction,
    dueDate: beforeCustomer.nextActionDate,
  };

  if (
    beforeCustomer.nextAction !== after.title ||
    beforeCustomer.nextActionDate !== after.dueDate
  ) {
    await notion.pages.update({
      page_id: input.customerPageId,
      properties: nextActionNotionPatch(propertiesByName, after),
    } as never);
  }

  const afterPage = await notion.pages.retrieve({
    page_id: input.customerPageId,
  });
  const afterCustomer = await notionPageToCustomer({
    page: afterPage as never,
    propertiesByName,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const contentHash = hashCustomerDomain(afterCustomer);
  const lastEditedTime =
    (afterPage as { last_edited_time?: string }).last_edited_time ?? null;

  const { error: updateError } = await admin
    .from("customer_index")
    .update({
      next_action: after.title,
      next_action_date: after.dueDate,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.customerPageId);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "customer.next_action.recalculated",
    entity_type: "customer",
    notion_page_id: input.customerPageId,
    changed_fields: {
      next_action: { before: before.title, after: after.title },
      next_action_date: { before: before.dueDate, after: after.dueDate },
      sourceActionPageId: after.actionPageId,
      sourceActionExternalId: input.sourceActionExternalId ?? null,
      jobId: input.jobId ?? null,
    },
    operation_source: "system",
    request_id: null,
  } as never);
  if (auditError) throw new Error(auditError.message);

  return {
    targetType: "customer",
    targetPageId: input.customerPageId,
    before,
    after,
  };
}

/**
 * 案件.次回アクション / 次回予定日 の system-only 再計算。
 * 案件に最新対応のロールアップは行わない。
 */
export async function recalculateDealNextAction(input: {
  dealPageId: string;
  sourceActionExternalId?: string | null;
  jobId?: string | null;
  notion?: Client;
  admin?: AdminClient;
  propertiesByName?: PropertyIdMap;
}): Promise<RecalculateNextActionResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadSchemaMaps(admin)).deals;

  const { data: actions, error: actError } = await admin
    .from("action_index")
    .select("notion_page_id,title,due_date,is_open")
    .eq("deal_page_id", input.dealPageId);
  if (actError) throw new Error(actError.message);

  const after = selectNextOpenAction(
    (actions ?? []) as Array<{
      notion_page_id: string;
      title: string;
      due_date: string | null;
      is_open: boolean;
    }>,
  );

  const { data: indexRow, error: indexError } = await admin
    .from("deal_index")
    .select("next_action,next_action_date")
    .eq("notion_page_id", input.dealPageId)
    .maybeSingle();
  if (indexError) throw new Error(indexError.message);
  if (!indexRow) {
    throw new Error("deal_index に対象案件がありません");
  }

  const page = await notion.pages.retrieve({ page_id: input.dealPageId });
  const beforeDeal = await notionPageToDeal({
    page: page as never,
    propertiesByName,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const before = {
    title: beforeDeal.nextAction,
    dueDate: beforeDeal.nextActionDate,
  };

  if (
    beforeDeal.nextAction !== after.title ||
    beforeDeal.nextActionDate !== after.dueDate
  ) {
    await notion.pages.update({
      page_id: input.dealPageId,
      properties: nextActionNotionPatch(propertiesByName, after),
    } as never);
  }

  const afterPage = await notion.pages.retrieve({ page_id: input.dealPageId });
  const afterDeal = await notionPageToDeal({
    page: afterPage as never,
    propertiesByName,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const contentHash = hashDealDomain(afterDeal);
  const lastEditedTime =
    (afterPage as { last_edited_time?: string }).last_edited_time ?? null;

  const { error: updateError } = await admin
    .from("deal_index")
    .update({
      next_action: after.title,
      next_action_date: after.dueDate,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.dealPageId);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "deal.next_action.recalculated",
    entity_type: "deal",
    notion_page_id: input.dealPageId,
    changed_fields: {
      next_action: { before: before.title, after: after.title },
      next_action_date: { before: before.dueDate, after: after.dueDate },
      sourceActionPageId: after.actionPageId,
      sourceActionExternalId: input.sourceActionExternalId ?? null,
      jobId: input.jobId ?? null,
    },
    operation_source: "system",
    request_id: null,
  } as never);
  if (auditError) throw new Error(auditError.message);

  return {
    targetType: "deal",
    targetPageId: input.dealPageId,
    before,
    after,
  };
}

import "server-only";

import type { Client } from "@notionhq/client";

import {
  computeCustomerExpectedAmountFromDeals,
  CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS,
} from "@/lib/deals/expected-amount";
import { hashCustomerDomain } from "@/lib/customers/content-hash";
import {
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RecalculateExpectedAmountResult = {
  customerPageId: string;
  before: number | null;
  after: number;
  dealCount: number;
};

async function loadCustomerPropertyMap(
  admin: AdminClient,
): Promise<PropertyIdMap> {
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
    };
  } | null;
  const props = value?.databases?.customers?.properties;
  if (!props) {
    throw new Error(
      "notion_schema_snapshot に customers プロパティがありません",
    );
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

/**
 * 顧客.見込み金額の system-only 再計算。
 * customerUpdate / ユーザー書込パイプラインは呼ばない。
 */
export async function recalculateCustomerExpectedAmount(input: {
  customerPageId: string;
  sourceDealExternalId?: string | null;
  jobId?: string | null;
  notion?: Client;
  admin?: AdminClient;
  propertiesByName?: PropertyIdMap;
}): Promise<RecalculateExpectedAmountResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadCustomerPropertyMap(admin));

  const amountProp = propertiesByName["見込み金額"];
  if (!amountProp) {
    throw new Error("顧客スナップショットに見込み金額がありません");
  }

  const { data: deals, error: dealsError } = await admin
    .from("deal_index")
    .select("status_semantic,expected_amount")
    .eq("customer_page_id", input.customerPageId);
  if (dealsError) throw new Error(dealsError.message);

  const rows = (deals ?? []) as Array<{
    status_semantic: string | null;
    expected_amount: number | null;
  }>;
  const after = computeCustomerExpectedAmountFromDeals(rows);
  const semanticSet = new Set<string>(CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS);
  const dealCount = rows.filter(
    (r) => r.status_semantic && semanticSet.has(r.status_semantic),
  ).length;

  const { data: indexRow, error: indexError } = await admin
    .from("customer_index")
    .select("expected_amount,external_id")
    .eq("notion_page_id", input.customerPageId)
    .maybeSingle();
  if (indexError) throw new Error(indexError.message);
  if (!indexRow) {
    throw new Error("customer_index に対象顧客がありません");
  }

  const beforeIndex =
    (indexRow.expected_amount as number | null | undefined) ?? null;

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
  const beforeNotion = beforeCustomer.expectedAmount;
  const before = beforeNotion ?? beforeIndex;

  if (beforeNotion !== after) {
    await notion.pages.update({
      page_id: input.customerPageId,
      properties: {
        [amountProp.id]: { number: after },
      },
    } as never);
  }

  // Notion再読込で content_hash を整合
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
      expected_amount: after,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.customerPageId);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "customer.expected_amount.recalculated",
    entity_type: "customer",
    notion_page_id: input.customerPageId,
    changed_fields: {
      expected_amount: { before, after },
      dealCount,
      sourceDealExternalId: input.sourceDealExternalId ?? null,
      jobId: input.jobId ?? null,
    },
    operation_source: "system",
    request_id: null,
  } as never);
  if (auditError) throw new Error(auditError.message);

  return {
    customerPageId: input.customerPageId,
    before,
    after,
    dealCount,
  };
}

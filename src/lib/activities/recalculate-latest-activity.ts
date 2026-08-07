import "server-only";

import type { Client } from "@notionhq/client";

import { hashCustomerDomain } from "@/lib/customers/content-hash";
import {
  notionPageToCustomer,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type LatestActivitySelection = {
  summary: string | null;
  activityAt: string | null;
  activityPageId: string | null;
};

export type RecalculateLatestActivityResult = {
  customerPageId: string;
  before: { summary: string | null; activityAt: string | null };
  after: LatestActivitySelection;
};

/**
 * 最新対応: max(activity_at), 同値なら notion_page_id desc。
 * 0件 → summary/activityAt は null(空文字にしない)。
 */
export function selectLatestActivity(
  rows: Array<{
    notion_page_id: string;
    summary: string | null;
    activity_at: string | null;
  }>,
): LatestActivitySelection {
  if (rows.length === 0) {
    return { summary: null, activityAt: null, activityPageId: null };
  }
  const sorted = [...rows].sort((a, b) => {
    const atA = a.activity_at ?? "";
    const atB = b.activity_at ?? "";
    if (atA !== atB) return atB.localeCompare(atA);
    return b.notion_page_id.localeCompare(a.notion_page_id);
  });
  const top = sorted[0]!;
  return {
    summary: top.summary ?? null,
    activityAt: top.activity_at ?? null,
    activityPageId: top.notion_page_id,
  };
}

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
 * 顧客.最新対応内容 / 最終対応日 の system-only 再計算。
 * 案件への対応履歴ロールアップは行わない。
 */
export async function recalculateCustomerLatestActivity(input: {
  customerPageId: string;
  sourceActivityExternalId?: string | null;
  jobId?: string | null;
  notion?: Client;
  admin?: AdminClient;
  propertiesByName?: PropertyIdMap;
}): Promise<RecalculateLatestActivityResult> {
  const admin = input.admin ?? createAdminClient();
  const notion = input.notion ?? createDefaultNotionClient();
  const propertiesByName =
    input.propertiesByName ?? (await loadCustomerPropertyMap(admin));

  const summaryProp = propertiesByName["最新対応内容"];
  const atProp = propertiesByName["最終対応日"];
  if (!summaryProp || !atProp) {
    throw new Error(
      "顧客スナップショットに最新対応内容/最終対応日がありません",
    );
  }

  const { data: activities, error: actError } = await admin
    .from("activity_index")
    .select("notion_page_id,summary,activity_at")
    .eq("customer_page_id", input.customerPageId);
  if (actError) throw new Error(actError.message);

  const after = selectLatestActivity(
    (activities ?? []) as Array<{
      notion_page_id: string;
      summary: string | null;
      activity_at: string | null;
    }>,
  );

  const { data: indexRow, error: indexError } = await admin
    .from("customer_index")
    .select("latest_activity_summary,last_activity_at,external_id")
    .eq("notion_page_id", input.customerPageId)
    .maybeSingle();
  if (indexError) throw new Error(indexError.message);
  if (!indexRow) {
    throw new Error("customer_index に対象顧客がありません");
  }

  const beforeIndex = {
    summary:
      (indexRow.latest_activity_summary as string | null | undefined) ?? null,
    activityAt:
      (indexRow.last_activity_at as string | null | undefined) ?? null,
  };

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
    summary: beforeCustomer.latestActivitySummary ?? beforeIndex.summary,
    activityAt: beforeCustomer.lastActivityAt ?? beforeIndex.activityAt,
  };

  const needNotionPatch =
    beforeCustomer.latestActivitySummary !== after.summary ||
    beforeCustomer.lastActivityAt !== after.activityAt;

  if (needNotionPatch) {
    await notion.pages.update({
      page_id: input.customerPageId,
      properties: {
        [summaryProp.id]: {
          rich_text: after.summary
            ? [{ text: { content: after.summary } }]
            : [],
        },
        [atProp.id]: {
          date: after.activityAt ? { start: after.activityAt } : null,
        },
      },
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
      latest_activity_summary: after.summary,
      last_activity_at: after.activityAt,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.customerPageId);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "customer.latest_activity.recalculated",
    entity_type: "customer",
    notion_page_id: input.customerPageId,
    changed_fields: {
      latest_activity_summary: { before: before.summary, after: after.summary },
      last_activity_at: { before: before.activityAt, after: after.activityAt },
      sourceActivityPageId: after.activityPageId,
      sourceActivityExternalId: input.sourceActivityExternalId ?? null,
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
  };
}

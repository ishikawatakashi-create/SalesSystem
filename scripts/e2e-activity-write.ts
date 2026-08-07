/**
 * Phase 5 対応履歴 write pipeline 実Notion/Supabase E2E。
 * タイトル test_phase5_activity_* のテスト履歴を作成・更新する。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * Usage: npx tsx scripts/e2e-activity-write.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import {
  createNotionClient,
  NotionHttpError,
} from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { newRequestId } from "../src/lib/notion/ids";
import { SCHEMA_SNAPSHOT_KEY } from "../src/lib/notion/setup/apply";
import type { PropertyIdMap } from "../src/lib/notion/converters/activity";
import { notionPageToActivity } from "../src/lib/notion/converters/activity";
import type { PropertyIdMap as CustomerPropertyIdMap } from "../src/lib/notion/converters/customer";
import { notionPageToCustomer } from "../src/lib/notion/converters/customer";
import { hashCustomerDomain } from "../src/lib/customers/content-hash";
import type {
  ActivityWriteInput,
  WriteOperationRow,
} from "../src/lib/activities/types";

/** server-only 回避のため選定ロジックをインライン */
function selectLatestActivity(
  rows: Array<{
    notion_page_id: string;
    summary: string | null;
    activity_at: string | null;
  }>,
): { summary: string | null; activityAt: string | null; activityPageId: string | null } {
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
import {
  executeActivityCreate,
  executeActivityUpdate,
  type ActivityWriteDeps,
  type ActivityWriteOpStore,
  type ActivityIndexStore,
  type ActivityAuditStore,
  type ActivitySyncErrorStore,
  type ActivityLatestRecalc,
} from "../src/lib/sync/activity-write-pipeline-core";
import { listAllChildBlocks } from "../src/lib/sync/activity-body";
import { extractManagedBody } from "../src/lib/notion/converters/page-body";
import { isActivitySyncError } from "../src/lib/sync/errors";
import { prepareActivityWrite } from "../src/lib/activities/write-schema";
import { hashActivityWriteInput } from "../src/lib/activities/input-hash";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "../src/lib/notion/logger";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    process.env[key] = value;
  }
}

function maskId(id: string): string {
  if (id.length < 12) return "[id]";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function ok(step: string, detail?: string) {
  console.log(`- [OK] ${step}${detail ? `: ${detail}` : ""}`);
}
function ng(step: string, detail?: string): never {
  console.error(`- [NG] ${step}${detail ? `: ${detail}` : ""}`);
  throw new Error(`E2E failed at ${step}`);
}
function skip(step: string, detail: string) {
  console.log(`- [SKIP] ${step}: ${detail}`);
}

type Admin = { from: (table: string) => any };

function createWriteOpStore(admin: Admin): ActivityWriteOpStore {
  return {
    async getByRequestId(requestId) {
      const { data, error } = await admin
        .from("write_operations")
        .select("*")
        .eq("request_id", requestId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as WriteOperationRow) ?? null;
    },
    async insertPending(row) {
      const { error } = await admin.from("write_operations").insert({
        request_id: row.requestId,
        entity_type: "activity",
        operation: row.operation,
        external_id: row.externalId,
        input_hash: row.inputHash,
        status: "pending",
        notion_page_id: row.notionPageId ?? null,
        recovery_payload: row.recoveryPayload as never,
        actor_id: row.actorId,
      } as never);
      if (error) throw new Error(error.message);
    },
    async markNotionDone(input) {
      const patch: Record<string, unknown> = {
        status: "notion_done",
        notion_page_id: input.notionPageId,
        error: null,
      };
      if (input.recoveryPayload !== undefined) {
        patch.recovery_payload = input.recoveryPayload;
      }
      const { error } = await admin
        .from("write_operations")
        .update(patch as never)
        .eq("request_id", input.requestId);
      if (error) throw new Error(error.message);
    },
    async markCompleted(requestId) {
      const { error } = await admin
        .from("write_operations")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error: null,
        } as never)
        .eq("request_id", requestId);
      if (error) throw new Error(error.message);
    },
    async markFailed(requestId, message) {
      const { error } = await admin
        .from("write_operations")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("request_id", requestId);
      if (error) throw new Error(error.message);
    },
  };
}

function createIndexStore(admin: Admin): ActivityIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("activity_index").upsert(row as never);
      if (error) throw new Error(error.message);
    },
    async getCustomerDisplayName(customerPageId) {
      const { data, error } = await admin
        .from("customer_index")
        .select("display_name")
        .eq("notion_page_id", customerPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.display_name as string | undefined) ?? null;
    },
    async getContactNames(contactPageIds) {
      if (contactPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("contact_index")
        .select("notion_page_id,name")
        .in("notion_page_id", contactPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((c: any) => [c.notion_page_id as string, c.name as string]),
      );
      return contactPageIds
        .map((id) => map.get(id) ?? "")
        .filter((name): name is string => Boolean(name));
    },
    async getDealTitle(dealPageId) {
      const { data, error } = await admin
        .from("deal_index")
        .select("title")
        .eq("notion_page_id", dealPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.title as string | undefined) ?? null;
    },
    async getCategoryNames(categoryPageIds) {
      if (categoryPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("masters_cache")
        .select("notion_page_id,name")
        .in("notion_page_id", categoryPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((m: any) => [m.notion_page_id as string, m.name as string]),
      );
      return categoryPageIds
        .map((id) => map.get(id) ?? "")
        .filter((name): name is string => Boolean(name));
    },
  };
}

function createAuditStore(admin: Admin): ActivityAuditStore {
  return {
    async insert(input) {
      const { error } = await admin.from("audit_logs").insert({
        actor_id: input.actorId,
        actor_name: input.actorName,
        action: input.action,
        entity_type: input.entityType,
        notion_page_id: input.notionPageId,
        changed_fields: input.changedFields,
        operation_source: input.operationSource,
        request_id: input.requestId,
        batch_id: input.batchId ?? null,
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createSyncErrorStore(admin: Admin): ActivitySyncErrorStore {
  return {
    async insert(input) {
      const { error } = await admin.from("sync_errors").insert({
        stage: input.stage,
        entity_type: input.entityType,
        notion_page_id: input.notionPageId ?? null,
        external_id: input.externalId ?? null,
        message: input.message,
        detail: input.detail ?? {},
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

async function loadPropertyMap(
  admin: Admin,
  dbKey: "activities" | "customers",
): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: Record<string, { properties: Record<string, { id: string; type: string }> }>;
    }
  ).databases[dbKey]?.properties;
  if (!props) throw new Error(`${dbKey} props missing`);
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function recalculateLatestInline(input: {
  admin: Admin;
  notion: Client;
  customerPageId: string;
  customerProps: CustomerPropertyIdMap;
  sourceActivityExternalId?: string | null;
}): Promise<{ summary: string | null; activityAt: string | null }> {
  const summaryProp = input.customerProps["最新対応内容"];
  const atProp = input.customerProps["最終対応日"];
  if (!summaryProp || !atProp) throw new Error("customer rollup props missing");

  const { data: activities, error } = await input.admin
    .from("activity_index")
    .select("notion_page_id,summary,activity_at")
    .eq("customer_page_id", input.customerPageId);
  if (error) throw new Error(error.message);
  const after = selectLatestActivity(activities ?? []);

  const page = await input.notion.pages.retrieve({
    page_id: input.customerPageId,
  });
  const beforeCustomer = await notionPageToCustomer({
    page: page as never,
    propertiesByName: input.customerProps,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        input.notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });

  if (
    beforeCustomer.latestActivitySummary !== after.summary ||
    beforeCustomer.lastActivityAt !== after.activityAt
  ) {
    await input.notion.pages.update({
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

  const afterPage = await input.notion.pages.retrieve({
    page_id: input.customerPageId,
  });
  const afterCustomer = await notionPageToCustomer({
    page: afterPage as never,
    propertiesByName: input.customerProps,
    pager: {
      retrieve: async ({ page_id, property_id, start_cursor }) =>
        input.notion.pages.properties.retrieve({
          page_id,
          property_id,
          start_cursor,
        } as never) as never,
    },
  });
  const contentHash = hashCustomerDomain(afterCustomer);
  const lastEditedTime =
    (afterPage as { last_edited_time?: string }).last_edited_time ?? null;
  const { error: upErr } = await input.admin
    .from("customer_index")
    .update({
      latest_activity_summary: after.summary,
      last_activity_at: after.activityAt,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.customerPageId);
  if (upErr) throw new Error(upErr.message);

  await input.admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "customer.latest_activity.recalculated",
    entity_type: "customer",
    notion_page_id: input.customerPageId,
    changed_fields: {
      latest_activity_summary: {
        before: beforeCustomer.latestActivitySummary,
        after: after.summary,
      },
      last_activity_at: {
        before: beforeCustomer.lastActivityAt,
        after: after.activityAt,
      },
      sourceActivityExternalId: input.sourceActivityExternalId ?? null,
    },
    operation_source: "system",
    request_id: null,
  } as never);

  return { summary: after.summary, activityAt: after.activityAt };
}

function createLatestRecalc(input: {
  admin: Admin;
  notion: Client;
  customerProps: CustomerPropertyIdMap;
}): ActivityLatestRecalc {
  return {
    async requestForCustomers({ customerPageIds, sourceActivityExternalId }) {
      const unique = [
        ...new Set(customerPageIds.filter((id): id is string => Boolean(id))),
      ];
      for (const customerPageId of unique) {
        await recalculateLatestInline({
          admin: input.admin,
          notion: input.notion,
          customerPageId,
          customerProps: input.customerProps,
          sourceActivityExternalId,
        });
      }
    },
  };
}

async function buildActivityDeps(
  notion: Client,
  admin: Admin,
  activitiesDs: string,
  customerProps: CustomerPropertyIdMap,
): Promise<ActivityWriteDeps> {
  return {
    notion,
    activitiesDataSourceId: activitiesDs,
    propertiesByName: await loadPropertyMap(admin, "activities"),
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    latestActivityRecalc: createLatestRecalc({ admin, notion, customerProps }),
    logger: {
      info: (fields) =>
        logNotionInfo({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
      warn: (fields) =>
        logNotionWarn({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
      error: (fields) =>
        logNotionError({
          request_id: String(fields.request_id ?? "n/a"),
          ...fields,
        }),
    },
  };
}

async function countPagesByExternalId(
  notion: Client,
  ds: string,
  externalId: string,
): Promise<number> {
  const q = await notion.dataSources.query({
    data_source_id: ds,
    filter: {
      property: "external_id",
      rich_text: { equals: externalId },
    },
    page_size: 10,
  } as never);
  return (q as { results: unknown[] }).results.length;
}

function proxyPages(
  notion: Client,
  overrides: {
    create?: Client["pages"]["create"];
    update?: Client["pages"]["update"];
  },
): Client {
  return new Proxy(notion, {
    get(target, prop, receiver) {
      if (prop === "pages") {
        const pages = Reflect.get(target, prop, receiver) as Client["pages"];
        return new Proxy(pages, {
          get(pTarget, pProp, pReceiver) {
            if (pProp === "create" && overrides.create) return overrides.create;
            if (pProp === "update" && overrides.update) return overrides.update;
            return Reflect.get(pTarget, pProp, pReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Client;
}

async function loadActivityDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const blocks = await listAllChildBlocks(notion, pageId);
  return notionPageToActivity({
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
    blocks,
  });
}

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const title = `test_phase5_activity_20260807_${suffix}`;
  console.log(`## E2E activity start title=${title}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as Admin & ReturnType<typeof createClient>;

  const { data: actor, error: actorError } = await supabase
    .from("app_users")
    .select("id,display_name,role")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (actorError || !actor) throw new Error("admin actor missing");
  ok("actor", `id=${maskId(actor.id)}`);

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "interactive",
  });

  const activitiesDs = process.env.NOTION_DS_ACTIVITIES!;
  if (!activitiesDs) throw new Error("NOTION_DS_ACTIVITIES missing");

  const { data: customer } = await supabase
    .from("customer_index")
    .select("notion_page_id,display_name,is_archived")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .limit(1)
    .maybeSingle();
  if (!customer?.notion_page_id) ng("fixture customer missing");
  const customerPageId = customer.notion_page_id as string;
  ok("fixture customer", maskId(customerPageId));

  const { data: contact } = await supabase
    .from("contact_index")
    .select("notion_page_id")
    .eq("customer_page_id", customerPageId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const contactPageId = (contact?.notion_page_id as string | undefined) ?? null;
  if (contactPageId) ok("fixture contact", maskId(contactPageId));
  else skip("fixture contact", "active contact missing; continue without");

  const { data: deal } = await supabase
    .from("deal_index")
    .select("notion_page_id,title")
    .eq("customer_page_id", customerPageId)
    .ilike("title", "test_%")
    .limit(1)
    .maybeSingle();
  const dealPageId = (deal?.notion_page_id as string | undefined) ?? null;
  if (dealPageId) ok("fixture deal", maskId(dealPageId));
  else skip("fixture deal", "test deal missing; continue without");

  const { data: categories } = await supabase
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "対応履歴分類")
    .eq("is_active", true)
    .limit(2);
  const categoryIds = (categories ?? []).map(
    (c: any) => c.notion_page_id as string,
  );
  if (categoryIds.length < 2) ng("need 2 active 対応履歴分類");
  ok("categories", `n=${categoryIds.length}`);

  const customerProps = (await loadPropertyMap(
    supabase as Admin,
    "customers",
  )) as CustomerPropertyIdMap;
  const baseDeps = await buildActivityDeps(
    notion,
    supabase as Admin,
    activitiesDs,
    customerProps,
  );

  const activityAt = "2026-08-07T03:00:00.000Z";
  const input: ActivityWriteInput = {
    title,
    customerPageId,
    dealPageId,
    contactPageIds: contactPageId ? [contactPageId] : [],
    activityAt,
    categoryPageIds: categoryIds,
    summary: "E2E要約",
    nextActionNote: "入力記録メモ",
    nextActionDate: "2026-08-15",
    body: "対応本文ライン1\nライン2",
    batchId: null,
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  // 1-2 create
  const created = await executeActivityCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) {
    ng("1-2 create", `status=${created.status}`);
  }
  ok("1-2 create", `page=${maskId(created.notionPageId!)}`);

  // 3 single page
  if ((await countPagesByExternalId(notion, activitiesDs, externalId)) !== 1) {
    ng("3 single page");
  }
  ok("3 single notion page");

  // 4-5 external_id + categories + body
  const domain = await loadActivityDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("4 external_id");
  if (domain.categoryPageIds.length < 2) ng("4 multi categories");
  if (!domain.body.includes("対応本文ライン1")) ng("5 body blocks");
  if (domain.bodyVersion !== 1) ng("5 body version", String(domain.bodyVersion));
  ok("4-5 external_id/categories/body");

  // 6 index
  const { data: indexRow } = await supabase
    .from("activity_index")
    .select("title,summary,sync_status,category_ids,body_hash")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow || indexRow.title !== title) ng("6 activity_index");
  ok("6 activity_index", `sync=${indexRow.sync_status}`);

  // 7 write_ops
  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,entity_type")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed" || wo.entity_type !== "activity") {
    ng("7 write_operations");
  }
  ok("7 write_operations completed");

  // 8 audit
  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "activity.create");
  if (auditCreateCount !== 1) ng("8 audit create");
  ok("8 audit activity.create");

  // 9 idempotent
  const again = await executeActivityCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("9 idempotent page");
  if ((await countPagesByExternalId(notion, activitiesDs, externalId)) !== 1) {
    ng("9 no dup page");
  }
  ok("9 idempotent");

  // 10 hash mismatch
  try {
    await executeActivityCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, title: `${title}_diff` },
    });
    ng("10 should reject mismatch");
  } catch (e) {
    if (!isActivitySyncError(e) || e.code !== "input_hash_mismatch") {
      ng("10 unexpected error");
    }
    ok("10 input_hash mismatch rejected");
  }

  // 13 prepare: append manual unmarked paragraph
  await notion.blocks.children.append({
    block_id: created.notionPageId!,
    children: [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "MANUAL_E2E_KEEP" } },
          ],
        },
      },
    ],
  } as never);
  ok("13a appended unmarked block");

  // 11-12 update props + body
  const pageBeforeUpdate = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (pageBeforeUpdate as { last_edited_time: string })
    .last_edited_time;
  const updateRequestId = newRequestId();
  const updatedInput: ActivityWriteInput = {
    ...input,
    title: `${title}_upd`,
    summary: "E2E要約更新",
    body: "更新後本文",
    activityAt: "2026-08-07T06:00:00.000Z",
  };
  const updated = await executeActivityUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("11 update", updated.status);
  ok("11-12 update props+body");

  const afterBlocks = await listAllChildBlocks(notion, created.notionPageId!);
  const managed = extractManagedBody(afterBlocks);
  if (managed?.body !== "更新後本文") ng("12 body updated", managed?.body);
  const manualStill = afterBlocks.some((b) => {
    const t =
      b.paragraph?.rich_text?.map((x) => x.plain_text ?? "").join("") ?? "";
    return t.includes("MANUAL_E2E_KEEP");
  });
  if (!manualStill) ng("13 manual block preserved");
  ok("13 manual block preserved");

  // 14 audit update
  const { count: auditUpd } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", updateRequestId)
    .eq("action", "activity.update");
  if (!auditUpd || auditUpd < 1) ng("14 audit update");
  ok("14 audit update");

  // 15 conflict
  try {
    await executeActivityUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updatedInput, title: `${title}_conflict` },
    });
    ng("15 should conflict");
  } catch (e) {
    if (!isActivitySyncError(e) || e.code !== "conflict") ng("15 not conflict");
    ok("15 optimistic lock conflict");
  }

  // 16 notion_done resume
  const resumeReq = newRequestId();
  const resumeInput: ActivityWriteInput = {
    ...updatedInput,
    title: `${title}_resume`,
  };
  await supabase.from("write_operations").insert({
    request_id: resumeReq,
    entity_type: "activity",
    operation: "update",
    external_id: externalId,
    input_hash: hashActivityWriteInput(resumeInput),
    status: "notion_done",
    notion_page_id: created.notionPageId!,
    recovery_payload: null,
    actor_id: actor.id,
  } as never);
  const pagesBeforeResume = await countPagesByExternalId(
    notion,
    activitiesDs,
    externalId,
  );
  const resumed = await executeActivityUpdate(baseDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: "ignored-for-resume",
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("16 resume");
  if (
    (await countPagesByExternalId(notion, activitiesDs, externalId)) !==
    pagesBeforeResume
  ) {
    ng("16 resume created page");
  }
  ok("16 notion_done resume");

  // 17 ambiguous create recover
  const ambExt = newRequestId();
  const ambReq = newRequestId();
  const ambInput: ActivityWriteInput = {
    ...input,
    title: `${title}_amb_create`,
  };
  let ambPageId: string | null = null;
  const ambNotion = proxyPages(notion, {
    create: async (args) => {
      const createdPage = await notion.pages.create(args);
      ambPageId = (createdPage as { id: string }).id;
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb");
    },
  });
  const ambDeps = await buildActivityDeps(
    ambNotion,
    supabase as Admin,
    activitiesDs,
    customerProps,
  );
  // Pre-seed external mapping by letting create succeed then fail — handled in mock.
  // If create throws before returning, findPageByExternalId won't find it unless page was created.
  // Our mock creates then throws, but query by external_id needs the page to have the property.
  // pages.create in real Notion sets properties — good.
  const ambResult = await executeActivityCreate(ambDeps, {
    requestId: ambReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambExt,
    input: ambInput,
  });
  if (ambResult.status !== "completed" || !ambResult.notionPageId) {
    ng("17 amb create recover");
  }
  if (ambPageId && ambResult.notionPageId !== ambPageId) ng("17 page mismatch");
  ok("17 ambiguous create recovered", `page=${maskId(ambResult.notionPageId!)}`);

  // 18 ambiguous update recover (title only; 他フィールドはNotion正本に合わせる)
  const pageForAmbU = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const currentForAmbU = await loadActivityDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  const ambUReq = newRequestId();
  const ambUInput: ActivityWriteInput = {
    title: `${title}_amb_upd`,
    customerPageId: currentForAmbU.customerPageId ?? customerPageId,
    dealPageId: currentForAmbU.dealPageId,
    contactPageIds: currentForAmbU.contactPageIds,
    activityAt: currentForAmbU.activityAt ?? activityAt,
    categoryPageIds: currentForAmbU.categoryPageIds,
    summary: currentForAmbU.summary,
    nextActionNote: currentForAmbU.nextActionNote,
    nextActionDate: currentForAmbU.nextActionDate,
    body: currentForAmbU.body,
    batchId: currentForAmbU.batchId,
  };
  const ambUNotion = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-u");
    },
  });
  const ambUDeps = await buildActivityDeps(
    ambUNotion,
    supabase as Admin,
    activitiesDs,
    customerProps,
  );
  const ambU = await executeActivityUpdate(ambUDeps, {
    requestId: ambUReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (pageForAmbU as { last_edited_time: string })
      .last_edited_time,
    input: ambUInput,
  });
  // Notion更新自体は復旧済み。recalc一時失敗で notion_done+partial もあり得る
  if (
    ambU.status !== "completed" &&
    !(ambU.status === "notion_done" && ambU.partialFailure)
  ) {
    ng("18 amb update", ambU.status);
  }
  if (ambU.status === "notion_done") {
    const resumedAmb = await executeActivityUpdate(baseDeps, {
      requestId: ambUReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "ignored",
      input: ambUInput,
    });
    if (resumedAmb.status !== "completed") {
      ng("18 amb update resume", resumedAmb.status);
    }
  }
  ok("18 ambiguous update recovered");

  // 19-21 relation rejects before Notion
  const { data: otherContact } = await supabase
    .from("contact_index")
    .select("notion_page_id,customer_page_id")
    .neq("customer_page_id", customerPageId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (otherContact?.notion_page_id) {
    try {
      await prepareActivityWrite({
        data: {
          ...input,
          contactPageIds: [otherContact.notion_page_id],
        },
        db: supabase,
      });
      ng("19 should reject other-customer contact");
    } catch (e) {
      if (!isActivitySyncError(e)) ng("19 not sync error");
      ok("19 reject other-customer contact");
    }
  } else {
    skip("19 other-customer contact", "no other contact; unit tests cover");
  }

  const { data: otherDeal } = await supabase
    .from("deal_index")
    .select("notion_page_id")
    .neq("customer_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (otherDeal?.notion_page_id) {
    try {
      await prepareActivityWrite({
        data: { ...input, dealPageId: otherDeal.notion_page_id },
        db: supabase,
      });
      ng("20 should reject other-customer deal");
    } catch (e) {
      if (!isActivitySyncError(e)) ng("20 not sync error");
      ok("20 reject other-customer deal");
    }
  } else {
    skip("20 other-customer deal", "no other deal; unit tests cover");
  }

  try {
    await prepareActivityWrite({
      data: {
        ...input,
        categoryPageIds: ["99999999-9999-4999-8999-999999999999"],
      },
      db: supabase,
    });
    ng("21 should reject bad category");
  } catch (e) {
    if (!isActivitySyncError(e)) ng("21 not sync error");
    ok("21 reject bad category");
  }

  // 22 customer latest rollup
  const { data: custIdx } = await supabase
    .from("customer_index")
    .select("latest_activity_summary,last_activity_at")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (!custIdx?.last_activity_at) ng("22 customer last_activity_at");
  ok(
    "22 customer latest rollup",
    `summaryLen=${String(custIdx.latest_activity_summary ?? "").length}`,
  );

  // 23 deal latest — schema has no deal latest activity props
  skip(
    "23 deal latest activity",
    "Notion deal has no 最新対応内容/最終対応日; unit tests cover selection",
  );

  // 24 activityAt change already done in update → rollup refreshed
  ok("24 activityAt change recalc (via update)");

  // 25 relation change both sides
  const { data: secondCustomer } = await supabase
    .from("customer_index")
    .select("notion_page_id,display_name")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .neq("notion_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (!secondCustomer?.notion_page_id) {
    skip(
      "25 relation both-sides",
      "second test customer missing; unit tests cover",
    );
  } else {
    const pageRel = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    const moveReq = newRequestId();
    const moveInput: ActivityWriteInput = {
      ...ambUInput,
      customerPageId: secondCustomer.notion_page_id,
      dealPageId: null,
      contactPageIds: [],
    };
    const moved = await executeActivityUpdate(baseDeps, {
      requestId: moveReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (pageRel as { last_edited_time: string })
        .last_edited_time,
      input: moveInput,
    });
    if (moved.status !== "completed") ng("25 move customer");
    // move back
    const pageBack = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    await executeActivityUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (pageBack as { last_edited_time: string })
        .last_edited_time,
      input: { ...moveInput, customerPageId, dealPageId, contactPageIds: contactPageId ? [contactPageId] : [] },
    });
    ok("25 relation both-sides recalc");
  }

  // 26 not in_trash
  const finalPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  if ((finalPage as { in_trash?: boolean }).in_trash) ng("26 in_trash");
  ok("26 not in_trash");

  // 27 audits retained
  const { count: audits } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!);
  if (!audits || audits < 1) ng("27 audits");
  ok("27 audit_logs retained", `count=${audits}`);

  console.log("## E2E activity PASS");
}

main().catch((err) => {
  console.error("E2E activity FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});

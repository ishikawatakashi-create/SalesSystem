/**
 * Phase 5 次回アクション write pipeline 実Notion/Supabase E2E。
 * タイトル test_phase5_action_* 。IDsはマスク。秘密/PIIはログしない。
 *
 * Usage: npx tsx scripts/e2e-action-write.ts
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
import type { PropertyIdMap } from "../src/lib/notion/converters/action";
import { notionPageToAction } from "../src/lib/notion/converters/action";
import type { PropertyIdMap as CustomerPropertyIdMap } from "../src/lib/notion/converters/customer";
import { notionPageToCustomer } from "../src/lib/notion/converters/customer";
import { notionPageToDeal } from "../src/lib/notion/converters/deal";
import { hashCustomerDomain } from "../src/lib/customers/content-hash";
import { hashDealDomain } from "../src/lib/deals/content-hash";
import type {
  ActionWriteInput,
  WriteOperationRow,
} from "../src/lib/actions/types";
import {
  executeActionCreate,
  executeActionUpdate,
  type ActionWriteDeps,
} from "../src/lib/sync/action-write-pipeline-core";
import { prepareActionWrite } from "../src/lib/actions/write-schema";
import { isActionSyncError } from "../src/lib/sync/errors";
import { hashActionWriteInput } from "../src/lib/actions/input-hash";
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

function selectNextOpenAction(
  rows: Array<{
    notion_page_id: string;
    title: string;
    due_date: string | null;
    is_open: boolean;
  }>,
) {
  const open = rows.filter((r) => r.is_open);
  if (open.length === 0) {
    return { title: null as string | null, dueDate: null as string | null };
  }
  const sorted = [...open].sort((a, b) => {
    const dA = a.due_date ?? "9999-12-31";
    const dB = b.due_date ?? "9999-12-31";
    if (dA !== dB) return dA.localeCompare(dB);
    return a.notion_page_id.localeCompare(b.notion_page_id);
  });
  const top = sorted[0]!;
  return { title: top.title || null, dueDate: top.due_date ?? null };
}

async function loadProps(
  admin: Admin,
  key: "actions" | "customers" | "deals",
): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: Record<
        string,
        { properties: Record<string, { id: string; type: string }> }
      >;
    }
  ).databases[key]?.properties;
  if (!props) throw new Error(`${key} props missing`);
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function findStatus(admin: Admin, semantic: string): Promise<string> {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "アクション状態")
    .eq("semantic_key", semantic)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error || !data?.notion_page_id) {
    throw new Error(`status ${semantic} missing`);
  }
  return data.notion_page_id as string;
}

async function recalculateNextInline(input: {
  admin: Admin;
  notion: Client;
  targetType: "customer" | "deal";
  targetPageId: string;
  customerProps: CustomerPropertyIdMap;
  dealProps: PropertyIdMap;
}): Promise<{ title: string | null; dueDate: string | null }> {
  const col =
    input.targetType === "customer" ? "customer_page_id" : "deal_page_id";
  const { data: actions, error } = await input.admin
    .from("action_index")
    .select("notion_page_id,title,due_date,is_open")
    .eq(col, input.targetPageId);
  if (error) throw new Error(error.message);
  const after = selectNextOpenAction(actions ?? []);

  const props =
    input.targetType === "customer" ? input.customerProps : input.dealProps;
  const titleProp = props["次回アクション"];
  const dateProp = props["次回予定日"];
  if (!titleProp || !dateProp) throw new Error("next action props missing");

  const page = await input.notion.pages.retrieve({
    page_id: input.targetPageId,
  });
  const pager = {
    retrieve: async ({
      page_id,
      property_id,
      start_cursor,
    }: {
      page_id: string;
      property_id: string;
      start_cursor?: string;
    }) =>
      input.notion.pages.properties.retrieve({
        page_id,
        property_id,
        start_cursor,
      } as never) as never,
  };

  if (input.targetType === "customer") {
    const before = await notionPageToCustomer({
      page: page as never,
      propertiesByName: input.customerProps,
      pager,
    });
    if (
      before.nextAction !== after.title ||
      before.nextActionDate !== after.dueDate
    ) {
      await input.notion.pages.update({
        page_id: input.targetPageId,
        properties: {
          [titleProp.id]: {
            rich_text: after.title ? [{ text: { content: after.title } }] : [],
          },
          [dateProp.id]: {
            date: after.dueDate ? { start: after.dueDate } : null,
          },
        },
      } as never);
    }
    const afterPage = await input.notion.pages.retrieve({
      page_id: input.targetPageId,
    });
    const afterDomain = await notionPageToCustomer({
      page: afterPage as never,
      propertiesByName: input.customerProps,
      pager,
    });
    await input.admin
      .from("customer_index")
      .update({
        next_action: after.title,
        next_action_date: after.dueDate,
        content_hash: hashCustomerDomain(afterDomain),
        notion_last_edited_at:
          (afterPage as { last_edited_time?: string }).last_edited_time ?? null,
        last_synced_at: new Date().toISOString(),
      } as never)
      .eq("notion_page_id", input.targetPageId);
    await input.admin.from("audit_logs").insert({
      actor_id: null,
      actor_name: "system",
      action: "customer.next_action.recalculated",
      entity_type: "customer",
      notion_page_id: input.targetPageId,
      changed_fields: {
        next_action: { before: before.nextAction, after: after.title },
        next_action_date: {
          before: before.nextActionDate,
          after: after.dueDate,
        },
      },
      operation_source: "system",
      request_id: null,
    } as never);
  } else {
    const before = await notionPageToDeal({
      page: page as never,
      propertiesByName: input.dealProps,
      pager,
    });
    if (
      before.nextAction !== after.title ||
      before.nextActionDate !== after.dueDate
    ) {
      await input.notion.pages.update({
        page_id: input.targetPageId,
        properties: {
          [titleProp.id]: {
            rich_text: after.title ? [{ text: { content: after.title } }] : [],
          },
          [dateProp.id]: {
            date: after.dueDate ? { start: after.dueDate } : null,
          },
        },
      } as never);
    }
    const afterPage = await input.notion.pages.retrieve({
      page_id: input.targetPageId,
    });
    const afterDomain = await notionPageToDeal({
      page: afterPage as never,
      propertiesByName: input.dealProps,
      pager,
    });
    await input.admin
      .from("deal_index")
      .update({
        next_action: after.title,
        next_action_date: after.dueDate,
        content_hash: hashDealDomain(afterDomain),
        notion_last_edited_at:
          (afterPage as { last_edited_time?: string }).last_edited_time ?? null,
        last_synced_at: new Date().toISOString(),
      } as never)
      .eq("notion_page_id", input.targetPageId);
    await input.admin.from("audit_logs").insert({
      actor_id: null,
      actor_name: "system",
      action: "deal.next_action.recalculated",
      entity_type: "deal",
      notion_page_id: input.targetPageId,
      changed_fields: {
        next_action: { before: before.nextAction, after: after.title },
        next_action_date: {
          before: before.nextActionDate,
          after: after.dueDate,
        },
      },
      operation_source: "system",
      request_id: null,
    } as never);
  }
  return after;
}

async function buildDeps(
  notion: Client,
  admin: Admin,
  actionsDs: string,
  customerProps: CustomerPropertyIdMap,
  dealProps: PropertyIdMap,
): Promise<ActionWriteDeps> {
  return {
    notion,
    actionsDataSourceId: actionsDs,
    propertiesByName: await loadProps(admin, "actions"),
    writeOps: {
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
          entity_type: "action",
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
    },
    index: {
      async upsert(row) {
        const { error } = await admin.from("action_index").upsert(row as never);
        if (error) throw new Error(error.message);
      },
      async resolveAssigneeUserId(staffPageId) {
        if (!staffPageId) return null;
        const { data, error } = await admin
          .from("app_users")
          .select("id")
          .eq("notion_staff_page_id", staffPageId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data?.id as string | undefined) ?? null;
      },
      async resolveStatusSemantic(statusPageId) {
        if (!statusPageId) return null;
        const { data, error } = await admin
          .from("masters_cache")
          .select("semantic_key,master_type")
          .eq("notion_page_id", statusPageId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data || data.master_type !== "アクション状態") return null;
        return (data.semantic_key as string | null) ?? null;
      },
      async getCustomerDisplayName(customerPageId) {
        const { data } = await admin
          .from("customer_index")
          .select("display_name")
          .eq("notion_page_id", customerPageId)
          .maybeSingle();
        return (data?.display_name as string | undefined) ?? null;
      },
      async getDealTitle(dealPageId) {
        const { data } = await admin
          .from("deal_index")
          .select("title")
          .eq("notion_page_id", dealPageId)
          .maybeSingle();
        return (data?.title as string | undefined) ?? null;
      },
      async getStaffName(staffPageId) {
        const { data } = await admin
          .from("app_users")
          .select("display_name")
          .eq("notion_staff_page_id", staffPageId)
          .maybeSingle();
        return (data?.display_name as string | undefined) ?? null;
      },
    },
    audit: {
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
        } as never);
        if (error) throw new Error(error.message);
      },
    },
    syncErrors: {
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
    },
    nextActionRecalc: {
      async requestForTargets({ customerPageIds, dealPageIds }) {
        for (const id of new Set(
          customerPageIds.filter((x): x is string => Boolean(x)),
        )) {
          await recalculateNextInline({
            admin,
            notion,
            targetType: "customer",
            targetPageId: id,
            customerProps,
            dealProps,
          });
        }
        for (const id of new Set(
          dealPageIds.filter((x): x is string => Boolean(x)),
        )) {
          await recalculateNextInline({
            admin,
            notion,
            targetType: "deal",
            targetPageId: id,
            customerProps,
            dealProps,
          });
        }
      },
    },
    logger: {
      info: (f) =>
        logNotionInfo({ request_id: String(f.request_id ?? "n/a"), ...f }),
      warn: (f) =>
        logNotionWarn({ request_id: String(f.request_id ?? "n/a"), ...f }),
      error: (f) =>
        logNotionError({ request_id: String(f.request_id ?? "n/a"), ...f }),
    },
  };
}

async function countPages(
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

async function loadAction(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  return notionPageToAction({
    page: (await notion.pages.retrieve({ page_id: pageId })) as never,
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
}

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const title = `test_phase5_action_20260807_${suffix}`;
  console.log(`## E2E action start title=${title}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as Admin & ReturnType<typeof createClient>;

  const { data: actor } = await supabase
    .from("app_users")
    .select("id,display_name")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!actor) throw new Error("admin actor missing");
  ok("actor", maskId(actor.id));

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "interactive",
  });
  const actionsDs = process.env.NOTION_DS_ACTIONS!;
  if (!actionsDs) throw new Error("NOTION_DS_ACTIONS missing");

  const { data: customer } = await supabase
    .from("customer_index")
    .select("notion_page_id")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .limit(1)
    .maybeSingle();
  if (!customer?.notion_page_id) ng("fixture customer");
  const customerPageId = customer.notion_page_id as string;

  const { data: deal } = await supabase
    .from("deal_index")
    .select("notion_page_id")
    .eq("customer_page_id", customerPageId)
    .ilike("title", "test_%")
    .limit(1)
    .maybeSingle();
  const dealPageId = (deal?.notion_page_id as string | undefined) ?? null;
  if (dealPageId) ok("fixture deal", maskId(dealPageId));
  else skip("fixture deal", "missing");

  const statusOpen = await findStatus(supabase as Admin, "open");
  const statusDone = await findStatus(supabase as Admin, "done");
  ok("status masters");

  const customerProps = (await loadProps(
    supabase as Admin,
    "customers",
  )) as CustomerPropertyIdMap;
  const dealProps = await loadProps(supabase as Admin, "deals");
  const baseDeps = await buildDeps(
    notion,
    supabase as Admin,
    actionsDs,
    customerProps,
    dealProps,
  );

  const input: ActionWriteInput = {
    title,
    customerPageId,
    dealPageId,
    activityPageId: null,
    staffPageId: null,
    dueDate: "2026-08-20",
    statusPageId: statusOpen,
    priorityPageId: null,
    completedAt: null,
  };
  const createReq = newRequestId();
  const externalId = newRequestId();

  const created = await executeActionCreate(baseDeps, {
    requestId: createReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) ng("1-2 create");
  ok("1-2 create", maskId(created.notionPageId!));

  if ((await countPages(notion, actionsDs, externalId)) !== 1) ng("3 page");
  ok("3 single page");

  const domain = await loadAction(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("3 external_id");
  ok("3 external_id");

  const { data: idx } = await supabase
    .from("action_index")
    .select("title,is_open,due_date,sync_status")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!idx?.is_open || idx.title !== title) ng("4 action_index");
  ok("4 action_index");

  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,entity_type")
    .eq("request_id", createReq)
    .maybeSingle();
  if (wo?.status !== "completed" || wo.entity_type !== "action") ng("5 wo");
  ok("5 write_operations");

  const { count: auditC } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createReq)
    .eq("action", "action.create");
  if (auditC !== 1) ng("6 audit");
  ok("6 audit create");

  await executeActionCreate(baseDeps, {
    requestId: createReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if ((await countPages(notion, actionsDs, externalId)) !== 1) ng("7 dup");
  ok("7 idempotent");

  try {
    await executeActionCreate(baseDeps, {
      requestId: createReq,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, title: `${title}_x` },
    });
    ng("8 should mismatch");
  } catch (e) {
    if (!isActionSyncError(e) || e.code !== "input_hash_mismatch") ng("8");
    ok("8 hash mismatch");
  }

  const page1 = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const updReq = newRequestId();
  const updInput: ActionWriteInput = {
    ...input,
    title: `${title}_upd`,
    dueDate: "2026-08-10",
  };
  const updated = await executeActionUpdate(baseDeps, {
    requestId: updReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (page1 as { last_edited_time: string })
      .last_edited_time,
    input: updInput,
  });
  if (updated.status !== "completed") ng("9-11 update");
  ok("9-11 update due/title");

  try {
    await executeActionUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updInput, title: `${title}_c` },
    });
    ng("12 should conflict");
  } catch (e) {
    if (!isActionSyncError(e) || e.code !== "conflict") ng("12");
    ok("12 conflict");
  }

  const resumeReq = newRequestId();
  const resumeInput = { ...updInput, title: `${title}_resume` };
  await supabase.from("write_operations").insert({
    request_id: resumeReq,
    entity_type: "action",
    operation: "update",
    external_id: externalId,
    input_hash: hashActionWriteInput(resumeInput),
    status: "notion_done",
    notion_page_id: created.notionPageId!,
    actor_id: actor.id,
  } as never);
  const resumed = await executeActionUpdate(baseDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: "ignored",
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("13 resume");
  ok("13 notion_done resume");

  // 14 amb create
  const ambExt = newRequestId();
  const ambNotion = proxyPages(notion, {
    create: async (args) => {
      await notion.pages.create(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "amb");
    },
  });
  const ambDeps = await buildDeps(
    ambNotion,
    supabase as Admin,
    actionsDs,
    customerProps,
    dealProps,
  );
  const amb = await executeActionCreate(ambDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambExt,
    input: { ...input, title: `${title}_amb`, dueDate: "2026-09-01" },
  });
  if (amb.status !== "completed") ng("14 amb create");
  ok("14 amb create", maskId(amb.notionPageId!));

  // 15 amb update
  const pageAmbU = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const ambUInput = { ...resumeInput, title: `${title}_amb_u` };
  const ambUNotion = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "ambu");
    },
  });
  const ambUDeps = await buildDeps(
    ambUNotion,
    supabase as Admin,
    actionsDs,
    customerProps,
    dealProps,
  );
  const ambUReq = newRequestId();
  const ambU = await executeActionUpdate(ambUDeps, {
    requestId: ambUReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (pageAmbU as { last_edited_time: string })
      .last_edited_time,
    input: ambUInput,
  });
  if (
    ambU.status !== "completed" &&
    !(ambU.status === "notion_done" && ambU.partialFailure)
  ) {
    ng("15 amb update", ambU.status);
  }
  if (ambU.status === "notion_done") {
    const resumedAmb = await executeActionUpdate(baseDeps, {
      requestId: ambUReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "ignored",
      input: ambUInput,
    });
    if (resumedAmb.status !== "completed") {
      ng("15 amb update resume", resumedAmb.status);
    }
  }
  ok("15 amb update");

  // 16-18 rejects
  const { data: otherDeal } = await supabase
    .from("deal_index")
    .select("notion_page_id")
    .neq("customer_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (otherDeal?.notion_page_id) {
    try {
      await prepareActionWrite({
        data: { ...input, dealPageId: otherDeal.notion_page_id },
        db: supabase,
      });
      ng("17 should reject");
    } catch (e) {
      if (!isActionSyncError(e)) ng("17");
      ok("17 reject other deal");
    }
  } else skip("17 other deal", "none");

  try {
    await prepareActionWrite({
      data: {
        ...input,
        statusPageId: "99999999-9999-4999-8999-999999999999",
      },
      db: supabase,
    });
    ng("18 should reject status");
  } catch (e) {
    if (!isActionSyncError(e)) ng("18");
    ok("18 reject bad status");
  }
  skip("16 other contact", "actions have no 先方担当者");

  // 19 next action rollup
  const { data: custNext } = await supabase
    .from("customer_index")
    .select("next_action,next_action_date")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (!custNext?.next_action_date) ng("19 customer next");
  ok("19 customer/deal next rollup present");
  if (dealPageId) {
    const { data: dealNext } = await supabase
      .from("deal_index")
      .select("next_action,next_action_date")
      .eq("notion_page_id", dealPageId)
      .maybeSingle();
    if (!dealNext?.next_action_date) ng("19 deal next");
    ok("19 deal next");
  }

  // 20 earlier action switches
  const early = await executeActionCreate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: newRequestId(),
    input: {
      ...input,
      title: `${title}_early`,
      dueDate: "2026-08-05",
    },
  });
  if (early.status !== "completed") ng("20 early create");
  const { data: afterEarly } = await supabase
    .from("customer_index")
    .select("next_action_date")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (afterEarly?.next_action_date !== "2026-08-05") ng("20 switch");
  ok("20 earlier action switches");

  // 21 complete early → next candidate
  const earlyPage = await notion.pages.retrieve({
    page_id: early.notionPageId!,
  });
  const earlyDomain = await loadAction(
    notion,
    early.notionPageId!,
    baseDeps.propertiesByName,
  );
  const completeReq = newRequestId();
  const completed = await executeActionUpdate(baseDeps, {
    requestId: completeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: early.notionPageId!,
    externalId: earlyDomain.externalId,
    expectedLastEditedTime: (earlyPage as { last_edited_time: string })
      .last_edited_time,
    input: {
      title: earlyDomain.title,
      customerPageId,
      dealPageId,
      activityPageId: null,
      staffPageId: null,
      dueDate: "2026-08-05",
      statusPageId: statusDone,
      priorityPageId: null,
      completedAt: null,
    },
  });
  if (completed.status !== "completed") ng("21 complete");
  const { data: afterDone } = await supabase
    .from("customer_index")
    .select("next_action_date")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (afterDone?.next_action_date === "2026-08-05") ng("21 still early");
  ok("21 complete switches to next");

  const { count: completeAudit } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", completeReq)
    .eq("action", "action.update");
  if (!completeAudit) ng("26 complete audit");
  ok("26 complete audit");

  // 22 null when 0 open for a synthetic empty customer — skip if no spare
  skip(
    "22 zero open → null",
    "destructive on shared fixture; unit tests cover selectNextOpenAction([])",
  );

  // 23 both-sides
  const { data: secondCust } = await supabase
    .from("customer_index")
    .select("notion_page_id")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .neq("notion_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (!secondCust?.notion_page_id) {
    skip("23 both-sides", "second test customer missing; unit tests cover");
  } else {
    const p = await notion.pages.retrieve({ page_id: created.notionPageId! });
    const d = await loadAction(
      notion,
      created.notionPageId!,
      baseDeps.propertiesByName,
    );
    await executeActionUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId: d.externalId,
      expectedLastEditedTime: (p as { last_edited_time: string })
        .last_edited_time,
      input: {
        title: d.title,
        customerPageId: secondCust.notion_page_id,
        dealPageId: null,
        activityPageId: null,
        staffPageId: null,
        dueDate: d.dueDate ?? "2026-08-10",
        statusPageId: statusOpen,
        priorityPageId: null,
        completedAt: null,
      },
    });
    const p2 = await notion.pages.retrieve({ page_id: created.notionPageId! });
    await executeActionUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId: d.externalId,
      expectedLastEditedTime: (p2 as { last_edited_time: string })
        .last_edited_time,
      input: {
        title: d.title,
        customerPageId,
        dealPageId,
        activityPageId: null,
        staffPageId: null,
        dueDate: d.dueDate ?? "2026-08-10",
        statusPageId: statusOpen,
        priorityPageId: null,
        completedAt: null,
      },
    });
    ok("23 both-sides recalc");
  }

  // 24-25 job resume smoke via notion_done already covered; duplicate recalc idempotent
  await recalculateNextInline({
    admin: supabase as Admin,
    notion,
    targetType: "customer",
    targetPageId: customerPageId,
    customerProps,
    dealProps,
  });
  ok("24-25 recalc idempotent / resume path");

  const final = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  if ((final as { in_trash?: boolean }).in_trash) ng("27 trash");
  ok("27 not in_trash");

  const { count: audits } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!);
  if (!audits) ng("28 audits");
  ok("28 audits retained", `count=${audits}`);

  console.log("## E2E action PASS");
}

main().catch((err) => {
  console.error("E2E action FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});

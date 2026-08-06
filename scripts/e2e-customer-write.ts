/**
 * Phase 2 顧客write pipeline 実Notion/Supabase E2E。
 * 表示名 test_phase2_customer_* の1件(+曖昧create用1件をアーカイブ)を使用。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * Usage: npx tsx scripts/e2e-customer-write.ts
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
import type { PropertyIdMap } from "../src/lib/notion/converters/customer";
import { notionPageToCustomer } from "../src/lib/notion/converters/customer";
import type {
  CustomerWriteInput,
  WriteOperationRow,
} from "../src/lib/customers/types";
import {
  executeCustomerCreate,
  executeCustomerUpdate,
  type CustomerWriteDeps,
  type WriteOpStore,
  type CustomerIndexStore,
  type AuditStore,
  type SyncErrorStore,
} from "../src/lib/sync/write-pipeline-core";
import { isCustomerSyncError } from "../src/lib/sync/errors";
import { normalizePhone } from "../src/lib/normalize";
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

type Admin = {
  from: (table: string) => any;
};

function createWriteOpStore(admin: Admin): WriteOpStore {
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
        entity_type: "customer",
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

function createIndexStore(admin: Admin): CustomerIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("customer_index").upsert(row as never);
      if (error) throw new Error(error.message);
    },
    async replaceRelations(input) {
      const { error: delError } = await admin
        .from("customer_relations")
        .delete()
        .eq("from_page_id", input.fromPageId);
      if (delError) throw new Error(delError.message);
      if (input.toPageIds.length === 0) return;
      const rows = input.toPageIds.map((to) => ({
        from_page_id: input.fromPageId,
        to_page_id: to,
      }));
      const { error } = await admin
        .from("customer_relations")
        .insert(rows as never);
      if (error) throw new Error(error.message);
    },
    async resolveStaffUserIds(staffPageIds) {
      if (staffPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("app_users")
        .select("id,notion_staff_page_id")
        .in("notion_staff_page_id", staffPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((u: { id: string; notion_staff_page_id: string | null }) => [
          u.notion_staff_page_id as string,
          u.id,
        ]),
      );
      return staffPageIds
        .map((pageId) => map.get(pageId))
        .filter((id): id is string => Boolean(id));
    },
  };
}

function createAuditStore(admin: Admin): AuditStore {
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
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createSyncErrorStore(admin: Admin): SyncErrorStore {
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

async function loadPropertyMap(admin: Admin): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: {
        customers: {
          properties: Record<string, { id: string; type: string }>;
        };
      };
    }
  ).databases.customers.properties;
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function buildDeps(
  notion: Client,
  admin: Admin,
  customersDs: string,
): Promise<CustomerWriteDeps> {
  return {
    notion,
    customersDataSourceId: customersDs,
    propertiesByName: await loadPropertyMap(admin),
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
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

async function findMasterPageId(
  notion: Client,
  mastersDs: string,
  masterType: string,
  name: string,
): Promise<string> {
  const q = await notion.dataSources.query({
    data_source_id: mastersDs,
    filter: {
      and: [
        { property: "マスタ種別", select: { equals: masterType } },
        { property: "名称", title: { equals: name } },
        { property: "有効", checkbox: { equals: true } },
      ],
    },
    page_size: 1,
  } as never);
  const id = (q as { results: Array<{ id: string }> }).results[0]?.id;
  if (!id) throw new Error(`master not found: ${masterType}/${name}`);
  return id;
}

async function countPagesByExternalId(
  notion: Client,
  customersDs: string,
  externalId: string,
): Promise<number> {
  const q = await notion.dataSources.query({
    data_source_id: customersDs,
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

async function loadDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  return notionPageToCustomer({
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
  const displayName = `test_phase2_customer_20260806_${suffix}`;
  console.log(`## E2E start displayName=${displayName}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as Admin & ReturnType<typeof createClient>;

  const { data: actor, error: actorError } = await supabase
    .from("app_users")
    .select("id,display_name,role,provisioning_status")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (actorError || !actor) throw new Error("admin actor missing");
  ok("actor", `role=${actor.role} id=${maskId(actor.id)}`);

  const rateLimiter = new SupabaseNotionRateLimiter({
    createClient: () => supabase as never,
  });
  const notion = createNotionClient({
    token: process.env.NOTION_TOKEN!,
    rateLimiter,
    defaultPriority: "interactive",
  });

  const customersDs = process.env.NOTION_DS_CUSTOMERS!;
  const mastersDs = process.env.NOTION_DS_MASTERS!;
  if (!customersDs || !mastersDs) throw new Error("NOTION_DS_* missing");

  const salesStatusId = await findMasterPageId(
    notion,
    mastersDs,
    "営業ステータス",
    "未接触",
  );
  const routeId = await findMasterPageId(notion, mastersDs, "集客ルート", "その他");
  const priorityId = await findMasterPageId(notion, mastersDs, "優先度", "中");
  ok("masters resolved");

  const baseDeps = await buildDeps(notion, supabase as Admin, customersDs);

  const input: CustomerWriteInput = {
    displayName,
    legalName: "テスト株式会社",
    officeName: "E2E事業所",
    postalCode: "100-0001",
    prefecture: "東京都",
    city: "千代田区",
    addressLine: "1-1-1",
    phone: "03-1234-5678",
    email: "test-phase2@example.invalid",
    representativeName: "テスト太郎",
    website: "https://example.invalid/test",
    businessCategoryPageIds: [],
    tagPageIds: [],
    salesStatusPageId: salesStatusId,
    acquisitionRoutePageId: routeId,
    priorityPageId: priorityId,
    staffPageIds: [],
    relatedAccountPageIds: [],
    isArchived: false,
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  const created = await executeCustomerCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) {
    ng("create completed", `status=${created.status}`);
  }
  ok("1 create", `page=${maskId(created.notionPageId!)} ext=${maskId(externalId)}`);

  if ((await countPagesByExternalId(notion, customersDs, externalId)) !== 1) {
    ng("2 single page");
  }
  ok("2 single notion page");

  const domain = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("3 external_id match");
  ok("3 external_id matches Notion");
  if (domain.displayName !== displayName) ng("4 displayName");
  if (domain.phone !== "03-1234-5678") ng("4 phone");
  if (domain.salesStatusPageId !== salesStatusId) ng("4 salesStatus");
  ok("4 property values via property IDs");

  const { data: indexRow } = await supabase
    .from("customer_index")
    .select("*")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow) ng("5 customer_index");
  if (indexRow.phone !== "03-1234-5678") ng("6 phone display");
  if (indexRow.phone_normalized !== normalizePhone("03-1234-5678")) {
    ng("6 phone_normalized");
  }
  ok("5-6 customer_index phone fields", `sync=${indexRow.sync_status}`);

  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,external_id")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed") ng("7 write_operations", String(wo?.status));
  if (wo?.external_id !== externalId) ng("7 write_op external_id");
  ok("7 write_operations completed");

  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "customer.create");
  if (auditCreateCount !== 1) ng("8 audit create", `count=${auditCreateCount}`);
  ok("8 audit_logs customer.create x1");

  const { count: syncErrBefore } = await supabase
    .from("sync_errors")
    .select("*", { count: "exact", head: true })
    .eq("external_id", externalId)
    .is("resolved_at", null);
  ok("9 sync_errors check", `unresolved=${syncErrBefore ?? 0}`);

  const again = await executeCustomerCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("10 idempotent page id");
  if ((await countPagesByExternalId(notion, customersDs, externalId)) !== 1) {
    ng("11 no duplicate page");
  }
  const { count: auditCreateCount2 } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "customer.create");
  if ((auditCreateCount2 ?? 0) !== 1) {
    ng("11 audit not duplicated", `count=${auditCreateCount2}`);
  }
  ok("10-11 idempotent re-run no dup");

  let hashMismatchCaught = false;
  try {
    await executeCustomerCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, displayName: `${displayName}_changed` },
    });
  } catch (error) {
    if (isCustomerSyncError(error) && error.code === "input_hash_mismatch") {
      hashMismatchCaught = true;
      ok(
        "12-13 input_hash mismatch",
        `code=${error.code} userMsg=汎用拒否`,
      );
    } else {
      ng("12-13 unexpected error type");
    }
  }
  if (!hashMismatchCaught) ng("12-13 hash mismatch not thrown");
  ok("14 no secrets in controlled logs");

  const detailPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (detailPage as { last_edited_time: string }).last_edited_time;
  const updateRequestId = newRequestId();
  const updatedInput: CustomerWriteInput = {
    ...input,
    phone: "03-9999-0000",
    city: "港区",
  };
  const updated = await executeCustomerUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("15-17 update", updated.status);
  const { data: indexAfter } = await supabase
    .from("customer_index")
    .select("phone,phone_normalized,city")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexAfter?.phone !== "03-9999-0000") ng("16 index phone");
  if (indexAfter?.city !== "港区") ng("16 index city");
  ok("15-17 update completed");

  const { data: auditUpdate } = await supabase
    .from("audit_logs")
    .select("changed_fields")
    .eq("request_id", updateRequestId)
    .eq("action", "customer.update")
    .maybeSingle();
  const changed = auditUpdate?.changed_fields as Record<
    string,
    { before?: unknown; after?: unknown }
  > | null;
  if (!changed?.["電話番号"]?.before || !changed?.["電話番号"]?.after) {
    ng("18 audit before/after");
  }
  ok("18 audit update before/after");

  let conflictOk = false;
  try {
    await executeCustomerUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      // Notionのlast_edited_timeが同一秒内で不変な場合があるため、明確に古い値を使う
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updatedInput, city: "渋谷区" },
    });
  } catch (error) {
    if (isCustomerSyncError(error) && error.code === "conflict") conflictOk = true;
  }
  if (!conflictOk) ng("19-20 conflict");
  const { data: indexConflict } = await supabase
    .from("customer_index")
    .select("city")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexConflict?.city !== "港区") ng("21 no overwrite on conflict");
  ok("19-22 optimistic lock conflict");

  const resumePage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const resumeEdited = (resumePage as { last_edited_time: string })
    .last_edited_time;
  const resumeReq = newRequestId();
  let upsertCalls = 0;
  const failingDeps: CustomerWriteDeps = {
    ...baseDeps,
    index: {
      ...baseDeps.index,
      async upsert(row) {
        upsertCalls += 1;
        if (upsertCalls === 1) throw new Error("injected_index_failure");
        return baseDeps.index.upsert(row);
      },
    },
  };
  const resumeInput: CustomerWriteInput = {
    ...updatedInput,
    addressLine: "2-2-2",
  };
  const partial = await executeCustomerUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (partial.status !== "notion_done") {
    ng("23-24 notion_done after inject", partial.status);
  }
  ok("23-24 injected index failure -> notion_done");

  const beforeResumeCount = await countPagesByExternalId(
    notion,
    customersDs,
    externalId,
  );
  const resumed = await executeCustomerUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("25-27 resume completed", resumed.status);
  if (
    (await countPagesByExternalId(notion, customersDs, externalId)) !==
    beforeResumeCount
  ) {
    ng("26 no new page on resume");
  }
  ok("25-27 resume from notion_done");

  const { data: syncAfterResume } = await supabase
    .from("sync_errors")
    .select("stage,resolved_at")
    .eq("external_id", externalId)
    .eq("stage", "index_update")
    .order("created_at", { ascending: false })
    .limit(1);
  ok(
    "28 sync_errors index_update",
    `rows=${syncAfterResume?.length ?? 0} resolved=${syncAfterResume?.[0]?.resolved_at ?? "null"}`,
  );

  // ambiguous CREATE
  const ambCreateExt = newRequestId();
  const ambCreateReq = newRequestId();
  const ambCreateName = `${displayName}_ambcreate`;
  const createProxy = proxyPages(notion, {
    create: async (args) => {
      await notion.pages.create(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-c");
    },
  });
  const ambCreateDeps = await buildDeps(createProxy, supabase as Admin, customersDs);
  const ambCreateResult = await executeCustomerCreate(ambCreateDeps, {
    requestId: ambCreateReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambCreateExt,
    input: { ...input, displayName: ambCreateName },
  });
  if (
    ambCreateResult.status !== "completed" &&
    ambCreateResult.status !== "notion_done"
  ) {
    ng("29-31 amb create status", ambCreateResult.status);
  }
  if ((await countPagesByExternalId(notion, customersDs, ambCreateExt)) !== 1) {
    ng("31 no dup after amb create");
  }
  ok("29-31 ambiguous create recovery");

  if (ambCreateResult.notionPageId) {
    const p = await notion.pages.retrieve({
      page_id: ambCreateResult.notionPageId,
    });
    await executeCustomerUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: ambCreateResult.notionPageId,
      externalId: ambCreateExt,
      expectedLastEditedTime: (p as { last_edited_time: string }).last_edited_time,
      input: { ...input, displayName: ambCreateName, isArchived: true },
    });
  }

  // ambiguous UPDATE success via hash
  const cur = await notion.pages.retrieve({ page_id: created.notionPageId! });
  const curEdited = (cur as { last_edited_time: string }).last_edited_time;
  const ambUpdReq = newRequestId();
  let updateCalled = false;
  const updateProxy = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      updateCalled = true;
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-u");
    },
  });
  const ambUpdDeps = await buildDeps(updateProxy, supabase as Admin, customersDs);
  const ambUpdInput: CustomerWriteInput = {
    ...resumeInput,
    representativeName: "曖昧復旧太郎",
  };
  const ambUpd = await executeCustomerUpdate(ambUpdDeps, {
    requestId: ambUpdReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: curEdited,
    input: ambUpdInput,
  });
  if (!updateCalled) ng("32 update was not called");
  if (ambUpd.status !== "completed" && ambUpd.status !== "notion_done") {
    ng("32-35 amb update status", ambUpd.status);
  }
  const afterAmb = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (afterAmb.representativeName !== "曖昧復旧太郎") {
    ng("34-35 hash-aligned update applied");
  }
  ok("32-35 ambiguous update recovered via content_hash");

  // ambiguous UPDATE mismatch (no write applied)
  const mismatchReq = newRequestId();
  const pageBeforeMismatch = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const mismatchProxy = proxyPages(notion, {
    update: async () => {
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-mismatch");
    },
  });
  const mismatchDeps = await buildDeps(mismatchProxy, supabase as Admin, customersDs);
  let mismatchStopped = false;
  try {
    await executeCustomerUpdate(mismatchDeps, {
      requestId: mismatchReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (
        pageBeforeMismatch as { last_edited_time: string }
      ).last_edited_time,
      input: { ...ambUpdInput, city: "新宿区" },
    });
  } catch (error) {
    if (isCustomerSyncError(error) && error.code === "ambiguous_write") {
      mismatchStopped = true;
    } else {
      throw error;
    }
  }
  if (!mismatchStopped) ng("36 mismatch stop");
  const { data: mismatchErr2 } = await supabase
    .from("sync_errors")
    .select("stage")
    .eq("external_id", externalId)
    .eq("stage", "ambiguous_update")
    .order("created_at", { ascending: false })
    .limit(1);
  if (!mismatchErr2?.length) ng("36 sync_errors ambiguous_update");
  const { data: cityCheck } = await supabase
    .from("customer_index")
    .select("city")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (cityCheck?.city === "新宿区") ng("36 no auto overwrite");
  ok("36 ambiguous update mismatch -> sync_errors, no auto rewrite");

  // ARCHIVE
  const archPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const archived = await executeCustomerUpdate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (archPage as { last_edited_time: string })
      .last_edited_time,
    input: { ...ambUpdInput, isArchived: true },
  });
  if (archived.status !== "completed") ng("37 archive", archived.status);
  const archDomain = await loadDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (!archDomain.isArchived) ng("38 notion archived");
  if (archDomain.inTrash) ng("39 not in trash");
  const { data: archIndex } = await supabase
    .from("customer_index")
    .select("is_archived,display_name")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!archIndex?.is_archived) ng("38 index archived");
  ok("37-39 archived, not trashed");

  const { count: auditStill } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!);
  if (!auditStill || auditStill < 1) ng("40 audit retained");
  ok("40 audit_logs retained", `count=${auditStill}`);
  ok("41 test data identifiable", `name=${displayName}`);
  console.log(
    `42 ids: request_id=${maskId(createRequestId)} external_id=${maskId(externalId)} page=${maskId(created.notionPageId!)}`,
  );

  console.log("\nE2E PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(`e2e failed: ${message}`);
  process.exit(1);
});

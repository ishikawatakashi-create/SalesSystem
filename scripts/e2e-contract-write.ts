/**
 * Phase 6 契約 write pipeline 実Notion/Supabase E2E。
 * 契約名 test_phase6_contract_* のテスト契約を作成・更新する。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * N/A (スキーマ/対象外のためスキップ。偽の合格にしない):
 * - contact relation: 契約DBに顧客担当者relationが無い
 * - contract file upload: 契約書ファイル(files)は書込対象外
 * - dual complaint→deal Notion reverse prop: 本スクリプト対象外
 *
 * Usage: npx tsx scripts/e2e-contract-write.ts
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
import type { PropertyIdMap } from "../src/lib/notion/converters/contract";
import { notionPageToContract } from "../src/lib/notion/converters/contract";
import type {
  ContractWriteInput,
  WriteOperationRow,
} from "../src/lib/contracts/types";
import { hashContractWriteInput } from "../src/lib/contracts/input-hash";
import { prepareContractWrite } from "../src/lib/contracts/write-schema";
import {
  executeContractCreate,
  executeContractUpdate,
  type ContractWriteDeps,
  type ContractWriteOpStore,
  type ContractIndexStore,
  type ContractAuditStore,
  type ContractSyncErrorStore,
} from "../src/lib/sync/contract-write-pipeline-core";
import { isContractSyncError } from "../src/lib/sync/errors";
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
  console.log(`- [N/A] ${step}: ${detail}`);
}

type Admin = { from: (table: string) => any };

function createWriteOpStore(admin: Admin): ContractWriteOpStore {
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
        entity_type: "contract",
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

function createIndexStore(admin: Admin): ContractIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("contract_index").upsert(row as never);
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
        (data ?? []).map((u: any) => [u.notion_staff_page_id as string, u.id]),
      );
      return staffPageIds
        .map((pageId) => map.get(pageId))
        .filter((id): id is string => Boolean(id));
    },
    async resolveStatusSemantic(statusPageId) {
      if (!statusPageId) return null;
      const { data, error } = await admin
        .from("masters_cache")
        .select("semantic_key,master_type")
        .eq("notion_page_id", statusPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || data.master_type !== "契約状態") return null;
      return (data.semantic_key as string | null) ?? null;
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
    async getDealTitle(dealPageId) {
      const { data, error } = await admin
        .from("deal_index")
        .select("title")
        .eq("notion_page_id", dealPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.title as string | undefined) ?? null;
    },
    async getStaffNames(staffPageIds) {
      if (staffPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("app_users")
        .select("notion_staff_page_id,display_name")
        .in("notion_staff_page_id", staffPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((u: any) => [
          u.notion_staff_page_id as string,
          u.display_name as string,
        ]),
      );
      return staffPageIds
        .map((id) => map.get(id) ?? "")
        .filter((name): name is string => Boolean(name));
    },
  };
}

function createAuditStore(admin: Admin): ContractAuditStore {
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

function createSyncErrorStore(admin: Admin): ContractSyncErrorStore {
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
      databases: Record<
        string,
        { properties: Record<string, { id: string; type: string }> }
      >;
    }
  ).databases.contracts?.properties;
  if (!props) throw new Error("contracts props missing");
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function buildContractDeps(
  notion: Client,
  admin: Admin,
  contractsDs: string,
): Promise<ContractWriteDeps> {
  return {
    notion,
    contractsDataSourceId: contractsDs,
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

async function loadContractDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  return notionPageToContract({
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
}

async function findMaster(
  admin: Admin,
  masterType: string,
  opts?: { semantic?: string; active?: boolean },
): Promise<string | null> {
  let q = admin
    .from("masters_cache")
    .select("notion_page_id,semantic_key,is_active")
    .eq("master_type", masterType);
  if (opts?.active !== undefined) q = q.eq("is_active", opts.active);
  if (opts?.semantic) q = q.eq("semantic_key", opts.semantic);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.notion_page_id as string | undefined) ?? null;
}

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const title = `test_phase6_contract_20260807_${suffix}`;
  console.log(`## E2E contract start title=${title}`);

  // N/A inventory (reported, not fake-pass)
  skip("contact relation", "契約スキーマに顧客担当者relationが無い");
  skip("contract file upload", "契約書ファイル(files)は書込対象外");
  skip(
    "dual complaint→deal reverse prop",
    "本E2E対象外(クレーム/案件双方向は別検証)",
  );

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

  const contractsDs = process.env.NOTION_DS_CONTRACTS!;
  if (!contractsDs) throw new Error("NOTION_DS_CONTRACTS missing");

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

  const statusActive = await findMaster(supabase as Admin, "契約状態", {
    semantic: "active",
    active: true,
  });
  const statusExpired = await findMaster(supabase as Admin, "契約状態", {
    semantic: "expired",
    active: true,
  });
  const paymentA = await findMaster(supabase as Admin, "支払状況", {
    active: true,
  });
  const { data: payments } = await supabase
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "支払状況")
    .eq("is_active", true)
    .limit(2);
  const paymentIds = (payments ?? []).map((p: any) => p.notion_page_id as string);
  const paymentB =
    paymentIds.find((id: string) => id !== paymentA) ?? paymentIds[1] ?? null;
  const statusInactive = await findMaster(supabase as Admin, "契約状態", {
    active: false,
  });

  if (!statusActive || !paymentA) ng("need active 契約状態/支払状況");
  ok(
    "masters",
    `status=${maskId(statusActive!)} payment=${maskId(paymentA!)}`,
  );

  const baseDeps = await buildContractDeps(
    notion,
    supabase as Admin,
    contractsDs,
  );

  const input: ContractWriteInput = {
    title,
    customerPageId,
    dealPageId,
    contractTypePageId: null,
    tradeTypePageId: null,
    paymentStatusPageId: paymentA,
    statusPageId: statusActive,
    staffPageIds: [],
    amount: 50_000,
    contractedAt: "2026-08-01",
    startDate: "2026-08-01",
    endDate: "2027-07-31",
    autoRenew: false,
    billingTerms: "月末締め翌月末払い",
    contractUrl: "https://example.com/phase6-contract",
    note: "phase6 e2e",
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  // 1 create
  const created = await executeContractCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) {
    ng("1 create", `status=${created.status}`);
  }
  ok("1 create", `page=${maskId(created.notionPageId!)}`);

  // 2 single page
  if ((await countPagesByExternalId(notion, contractsDs, externalId)) !== 1) {
    ng("2 single page");
  }
  ok("2 single notion page");

  // 3 properties
  const domain = await loadContractDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("3 external_id");
  if (domain.title !== title) ng("3 title");
  if (domain.customerPageId !== customerPageId) ng("3 customer");
  if (domain.amount !== 50_000) ng("3 amount");
  if (domain.statusPageId !== statusActive) ng("3 status");
  ok("3 external_id + properties");

  // 4 index
  const { data: indexRow } = await supabase
    .from("contract_index")
    .select("title,amount,status_semantic,sync_status,has_contract_url")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow || indexRow.title !== title) ng("4 contract_index");
  if (indexRow.status_semantic !== "active") ng("4 status_semantic");
  if (indexRow.has_contract_url !== true) ng("4 has_contract_url");
  ok("4 contract_index", `sync=${indexRow.sync_status}`);

  // 5 write_ops
  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,entity_type")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed" || wo.entity_type !== "contract") {
    ng("5 write_operations");
  }
  ok("5 write_operations completed");

  // 6 audit
  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "contract.create");
  if (auditCreateCount !== 1) ng("6 audit create");
  ok("6 audit contract.create");

  // 7 idempotent
  const again = await executeContractCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("7 idempotent page");
  if ((await countPagesByExternalId(notion, contractsDs, externalId)) !== 1) {
    ng("7 no dup page");
  }
  ok("7 idempotent");

  // 8 hash mismatch
  try {
    await executeContractCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, title: `${title}_diff` },
    });
    ng("8 should reject mismatch");
  } catch (e) {
    if (!isContractSyncError(e) || e.code !== "input_hash_mismatch") {
      ng("8 unexpected error");
    }
    ok("8 input_hash mismatch rejected");
  }

  // 9 update status+payment+amount
  const pageBeforeUpdate = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (pageBeforeUpdate as { last_edited_time: string })
    .last_edited_time;
  const updateRequestId = newRequestId();
  const nextStatus = statusExpired ?? statusActive!;
  const nextPayment = paymentB ?? paymentA!;
  const updatedInput: ContractWriteInput = {
    ...input,
    title: `${title}_upd`,
    amount: 75_000,
    statusPageId: nextStatus,
    paymentStatusPageId: nextPayment,
    autoRenew: true,
  };
  const updated = await executeContractUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("9 update", updated.status);
  const { data: indexAfter } = await supabase
    .from("contract_index")
    .select("amount,status_id,payment_status_id,auto_renew")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexAfter?.amount !== 75_000) ng("9 amount");
  if (indexAfter?.status_id !== nextStatus) ng("9 status change");
  if (indexAfter?.payment_status_id !== nextPayment) ng("9 payment change");
  ok("9 status+payment+amount update");

  // 10 conflict
  try {
    await executeContractUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updatedInput, title: `${title}_conflict` },
    });
    ng("10 should conflict");
  } catch (e) {
    if (!isContractSyncError(e) || e.code !== "conflict") ng("10 not conflict");
    ok("10 optimistic lock conflict");
  }

  // 11 notion_done resume
  const resumeReq = newRequestId();
  const resumeInput: ContractWriteInput = {
    ...updatedInput,
    title: `${title}_resume`,
  };
  await supabase.from("write_operations").insert({
    request_id: resumeReq,
    entity_type: "contract",
    operation: "update",
    external_id: externalId,
    input_hash: hashContractWriteInput(resumeInput),
    status: "notion_done",
    notion_page_id: created.notionPageId!,
    recovery_payload: null,
    actor_id: actor.id,
  } as never);
  const pagesBeforeResume = await countPagesByExternalId(
    notion,
    contractsDs,
    externalId,
  );
  const resumed = await executeContractUpdate(baseDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: "ignored-for-resume",
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("11 resume");
  if (
    (await countPagesByExternalId(notion, contractsDs, externalId)) !==
    pagesBeforeResume
  ) {
    ng("11 resume created page");
  }
  ok("11 notion_done resume");

  // 12 ambiguous create recover
  const ambExt = newRequestId();
  const ambReq = newRequestId();
  const ambInput: ContractWriteInput = {
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
  const ambDeps = await buildContractDeps(
    ambNotion,
    supabase as Admin,
    contractsDs,
  );
  const ambResult = await executeContractCreate(ambDeps, {
    requestId: ambReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambExt,
    input: ambInput,
  });
  if (ambResult.status !== "completed" || !ambResult.notionPageId) {
    ng("12 amb create recover");
  }
  if (ambPageId && ambResult.notionPageId !== ambPageId) ng("12 page mismatch");
  ok("12 ambiguous create recovered", `page=${maskId(ambResult.notionPageId!)}`);

  // 13 ambiguous update recover
  const pageForAmbU = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const currentForAmbU = await loadContractDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  const ambUReq = newRequestId();
  const ambUInput: ContractWriteInput = {
    title: `${title}_amb_upd`,
    customerPageId: currentForAmbU.customerPageId ?? customerPageId,
    dealPageId: currentForAmbU.dealPageId,
    contractTypePageId: currentForAmbU.contractTypePageId,
    tradeTypePageId: currentForAmbU.tradeTypePageId,
    paymentStatusPageId: currentForAmbU.paymentStatusPageId,
    statusPageId: currentForAmbU.statusPageId,
    staffPageIds: currentForAmbU.staffPageIds,
    amount: currentForAmbU.amount,
    contractedAt: currentForAmbU.contractedAt,
    startDate: currentForAmbU.startDate,
    endDate: currentForAmbU.endDate,
    autoRenew: currentForAmbU.autoRenew,
    billingTerms: currentForAmbU.billingTerms,
    contractUrl: currentForAmbU.contractUrl,
    note: currentForAmbU.note,
  };
  const ambUNotion = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-u");
    },
  });
  const ambUDeps = await buildContractDeps(
    ambUNotion,
    supabase as Admin,
    contractsDs,
  );
  const ambU = await executeContractUpdate(ambUDeps, {
    requestId: ambUReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (pageForAmbU as { last_edited_time: string })
      .last_edited_time,
    input: ambUInput,
  });
  if (
    ambU.status !== "completed" &&
    !(ambU.status === "notion_done" && ambU.partialFailure)
  ) {
    ng("13 amb update", ambU.status);
  }
  if (ambU.status === "notion_done") {
    const resumedAmb = await executeContractUpdate(baseDeps, {
      requestId: ambUReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "ignored",
      input: ambUInput,
    });
    if (resumedAmb.status !== "completed") {
      ng("13 amb update resume", resumedAmb.status);
    }
  }
  ok("13 ambiguous update recovered");

  // 14 master rejects
  try {
    await prepareContractWrite({
      data: {
        ...input,
        statusPageId: "99999999-9999-4999-8999-999999999999",
      },
      db: supabase,
    });
    ng("14 should reject bad status");
  } catch (e) {
    if (!isContractSyncError(e)) ng("14 not sync error");
    ok("14 reject bad master");
  }

  // 15 deal customer mismatch
  const { data: otherDeal } = await supabase
    .from("deal_index")
    .select("notion_page_id")
    .neq("customer_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (otherDeal?.notion_page_id) {
    try {
      await prepareContractWrite({
        data: { ...input, dealPageId: otherDeal.notion_page_id },
        db: supabase,
      });
      ng("15 should reject other-customer deal");
    } catch (e) {
      if (!isContractSyncError(e)) ng("15 not sync error");
      ok("15 reject deal customer mismatch");
    }
  } else {
    skip("15 deal customer mismatch", "no other deal; unit tests cover");
  }

  // 16 inactive retain
  if (statusInactive) {
    const pageRetain = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    const currentRetain = await loadContractDomain(
      notion,
      created.notionPageId!,
      baseDeps.propertiesByName,
    );
    // 一度 inactive を Notion に直接セットしてから維持更新
    const statusProp = baseDeps.propertiesByName["状態"];
    if (!statusProp) ng("16 status prop missing");
    await notion.pages.update({
      page_id: created.notionPageId!,
      properties: {
        [statusProp.id]: { relation: [{ id: statusInactive }] },
      },
    } as never);
    const pageAfterDirect = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    const retainInput: ContractWriteInput = {
      title: currentRetain.title,
      customerPageId: currentRetain.customerPageId ?? customerPageId,
      dealPageId: currentRetain.dealPageId,
      contractTypePageId: currentRetain.contractTypePageId,
      tradeTypePageId: currentRetain.tradeTypePageId,
      paymentStatusPageId: currentRetain.paymentStatusPageId,
      statusPageId: statusInactive,
      staffPageIds: currentRetain.staffPageIds,
      amount: currentRetain.amount,
      contractedAt: currentRetain.contractedAt,
      startDate: currentRetain.startDate,
      endDate: currentRetain.endDate,
      autoRenew: currentRetain.autoRenew,
      billingTerms: currentRetain.billingTerms,
      contractUrl: currentRetain.contractUrl,
      note: "inactive retain e2e",
    };
    try {
      await prepareContractWrite({
        data: retainInput,
        db: supabase,
        context: {
          current: {
            customerPageId: currentRetain.customerPageId,
            dealPageId: currentRetain.dealPageId,
            contractTypePageId: currentRetain.contractTypePageId,
            tradeTypePageId: currentRetain.tradeTypePageId,
            paymentStatusPageId: currentRetain.paymentStatusPageId,
            statusPageId: statusInactive,
            staffPageIds: currentRetain.staffPageIds,
          },
        },
      });
      const retainUpd = await executeContractUpdate(baseDeps, {
        requestId: newRequestId(),
        actorId: actor.id,
        actorName: actor.display_name,
        notionPageId: created.notionPageId!,
        externalId,
        expectedLastEditedTime: (
          pageAfterDirect as { last_edited_time: string }
        ).last_edited_time,
        input: retainInput,
      });
      if (retainUpd.status !== "completed") ng("16 inactive retain update");
      ok("16 inactive status retain");
    } catch (e) {
      ng(
        "16 inactive retain",
        isContractSyncError(e) ? e.code : "unexpected",
      );
    }
    void pageRetain;
  } else {
    skip("16 inactive retain", "inactive 契約状態 missing; unit tests cover");
  }

  // 17 not in_trash
  const finalPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  if ((finalPage as { in_trash?: boolean }).in_trash) ng("17 in_trash");
  ok("17 not in_trash");

  console.log("## E2E contract PASS");
}

main().catch((e) => {
  console.error("E2E contract FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Phase 6 クレーム write pipeline 実Notion/Supabase E2E。
 * タイトル test_phase6_complaint_* のテストクレームを作成・更新する。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * N/A (スキーマ/対象外のためスキップ。偽の合格にしない):
 * - contact relation: クレームDBに顧客担当者relationが無い
 * - contract file upload: 契約書ファイルは本スクリプト対象外
 * - dual complaint→deal Notion reverse prop: 案件側の双方向被リレーション検証は未実装のためN/A
 *
 * Usage: npx tsx scripts/e2e-complaint-write.ts
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
import type { PropertyIdMap } from "../src/lib/notion/converters/complaint";
import { notionPageToComplaint } from "../src/lib/notion/converters/complaint";
import {
  extractManagedComplaintBody,
} from "../src/lib/notion/converters/page-body";
import type {
  ComplaintWriteInput,
  WriteOperationRow,
} from "../src/lib/complaints/types";
import { hashComplaintWriteInput } from "../src/lib/complaints/input-hash";
import { prepareComplaintWrite } from "../src/lib/complaints/write-schema";
import {
  executeComplaintCreate,
  executeComplaintUpdate,
  type ComplaintWriteDeps,
  type ComplaintWriteOpStore,
  type ComplaintIndexStore,
  type ComplaintAuditStore,
  type ComplaintSyncErrorStore,
} from "../src/lib/sync/complaint-write-pipeline-core";
import { listAllChildBlocks } from "../src/lib/sync/activity-body";
import { isComplaintSyncError } from "../src/lib/sync/errors";
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

function createWriteOpStore(admin: Admin): ComplaintWriteOpStore {
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
        entity_type: "complaint",
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

function createIndexStore(admin: Admin): ComplaintIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("complaint_index").upsert(row as never);
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
      if (!data || data.master_type !== "クレーム対応状況") return null;
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
    async getStaffName(staffPageId) {
      const { data, error } = await admin
        .from("app_users")
        .select("display_name")
        .eq("notion_staff_page_id", staffPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.display_name as string | undefined) ?? null;
    },
  };
}

function createAuditStore(admin: Admin): ComplaintAuditStore {
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

function createSyncErrorStore(admin: Admin): ComplaintSyncErrorStore {
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
  ).databases.complaints?.properties;
  if (!props) throw new Error("complaints props missing");
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function buildComplaintDeps(
  notion: Client,
  admin: Admin,
  complaintsDs: string,
): Promise<ComplaintWriteDeps> {
  return {
    notion,
    complaintsDataSourceId: complaintsDs,
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

async function loadComplaintDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const blocks = await listAllChildBlocks(notion, pageId);
  return notionPageToComplaint({
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
  const title = `test_phase6_complaint_20260807_${suffix}`;
  console.log(`## E2E complaint start title=${title}`);

  skip("contact relation", "クレームスキーマに顧客担当者relationが無い");
  skip("contract file upload", "契約書ファイルは本スクリプト対象外");
  skip(
    "dual complaint→deal reverse prop",
    "案件側双方向被リレーション検証は未実装",
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

  const complaintsDs = process.env.NOTION_DS_COMPLAINTS!;
  if (!complaintsDs) throw new Error("NOTION_DS_COMPLAINTS missing");

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

  const severity = await findMaster(supabase as Admin, "クレーム重要度", {
    active: true,
  });
  const { data: severities } = await supabase
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "クレーム重要度")
    .eq("is_active", true)
    .limit(2);
  const severityIds = (severities ?? []).map(
    (s: any) => s.notion_page_id as string,
  );
  const severityB =
    severityIds.find((id: string) => id !== severity) ??
    severityIds[1] ??
    null;
  const statusOpen = await findMaster(supabase as Admin, "クレーム対応状況", {
    semantic: "open",
    active: true,
  });
  const statusInProgress = await findMaster(
    supabase as Admin,
    "クレーム対応状況",
    { semantic: "in_progress", active: true },
  );
  const statusDone = await findMaster(supabase as Admin, "クレーム対応状況", {
    semantic: "done",
    active: true,
  });
  const statusInactive = await findMaster(
    supabase as Admin,
    "クレーム対応状況",
    { active: false },
  );

  if (!severity || !statusOpen || !statusDone) {
    ng("need クレーム重要度 / open / done");
  }
  ok(
    "masters",
    `sev=${maskId(severity!)} open=${maskId(statusOpen!)} done=${maskId(statusDone!)}`,
  );

  const baseDeps = await buildComplaintDeps(
    notion,
    supabase as Admin,
    complaintsDs,
  );

  const input: ComplaintWriteInput = {
    title,
    customerPageId,
    dealPageId,
    severityPageId: severity,
    statusPageId: statusOpen,
    staffPageId: null,
    occurredOn: "2026-08-07",
    summary: "E2E概要",
    dueDate: "2026-08-20",
    completedOn: null,
    note: "phase6 complaint e2e",
    content: "内容セクション本文",
    cause: "原因セクション本文",
    response: "対応内容セクション本文",
    prevention: "再発防止策セクション本文",
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  // 1 create
  const created = await executeComplaintCreate(baseDeps, {
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
  if ((await countPagesByExternalId(notion, complaintsDs, externalId)) !== 1) {
    ng("2 single page");
  }
  ok("2 single notion page");

  // 3-4 properties + body sections
  const domain = await loadComplaintDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("3 external_id");
  if (domain.title !== title) ng("3 title");
  if (domain.severityPageId !== severity) ng("3 severity");
  if (domain.statusPageId !== statusOpen) ng("3 status");
  if (domain.content !== "内容セクション本文") ng("4 content");
  if (domain.cause !== "原因セクション本文") ng("4 cause");
  if (domain.response !== "対応内容セクション本文") ng("4 response");
  if (domain.prevention !== "再発防止策セクション本文") ng("4 prevention");
  if (domain.bodyVersion !== 1) ng("4 body version", String(domain.bodyVersion));
  ok("3-4 external_id/severity/status/body sections");

  // 5 index
  const { data: indexRow } = await supabase
    .from("complaint_index")
    .select("title,summary,status_semantic,sync_status,body_hash")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow || indexRow.title !== title) ng("5 complaint_index");
  if (indexRow.status_semantic !== "open") ng("5 status_semantic");
  ok("5 complaint_index", `sync=${indexRow.sync_status}`);

  // 6 write_ops
  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,entity_type")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed" || wo.entity_type !== "complaint") {
    ng("6 write_operations");
  }
  ok("6 write_operations completed");

  // 7 audit
  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "complaint.create");
  if (auditCreateCount !== 1) ng("7 audit create");
  ok("7 audit complaint.create");

  // 8 idempotent
  const again = await executeComplaintCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("8 idempotent page");
  if ((await countPagesByExternalId(notion, complaintsDs, externalId)) !== 1) {
    ng("8 no dup page");
  }
  ok("8 idempotent");

  // 9 hash mismatch
  try {
    await executeComplaintCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, title: `${title}_diff` },
    });
    ng("9 should reject mismatch");
  } catch (e) {
    if (!isComplaintSyncError(e) || e.code !== "input_hash_mismatch") {
      ng("9 unexpected error");
    }
    ok("9 input_hash mismatch rejected");
  }

  // 10 append manual block
  await notion.blocks.children.append({
    block_id: created.notionPageId!,
    children: [
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "MANUAL_E2E_KEEP_COMPLAINT" } },
          ],
        },
      },
    ],
  } as never);
  ok("10a appended unmarked block");

  // 11 update severity/status + body
  const pageBeforeUpdate = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (pageBeforeUpdate as { last_edited_time: string })
    .last_edited_time;
  const updateRequestId = newRequestId();
  const nextSeverity = severityB ?? severity!;
  const nextStatus = statusInProgress ?? statusOpen!;
  const updatedInput: ComplaintWriteInput = {
    ...input,
    title: `${title}_upd`,
    severityPageId: nextSeverity,
    statusPageId: nextStatus,
    summary: "E2E概要更新",
    content: "更新後内容",
    cause: "更新後原因",
    response: "更新後対応",
    prevention: "更新後防止",
  };
  const updated = await executeComplaintUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("11 update", updated.status);

  const afterBlocks = await listAllChildBlocks(notion, created.notionPageId!);
  const managed = extractManagedComplaintBody(afterBlocks);
  if (managed?.sections.content !== "更新後内容") ng("11 body content");
  if (managed?.sections.cause !== "更新後原因") ng("11 body cause");
  const manualStill = afterBlocks.some((b) => {
    const t =
      b.paragraph?.rich_text?.map((x) => x.plain_text ?? "").join("") ?? "";
    return t.includes("MANUAL_E2E_KEEP_COMPLAINT");
  });
  if (!manualStill) ng("12 manual block preserved");
  ok("11-12 severity/status/body update + manual preserve");

  // 13 resolve to done
  const pageBeforeDone = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const doneReq = newRequestId();
  const doneInput: ComplaintWriteInput = {
    ...updatedInput,
    statusPageId: statusDone!,
    completedOn: null,
  };
  const doneResult = await executeComplaintUpdate(baseDeps, {
    requestId: doneReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (pageBeforeDone as { last_edited_time: string })
      .last_edited_time,
    input: doneInput,
  });
  if (doneResult.status !== "completed") ng("13 resolve", doneResult.status);
  const { data: indexDone } = await supabase
    .from("complaint_index")
    .select("status_semantic,completed_on")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexDone?.status_semantic !== "done") ng("13 status_semantic done");
  if (!indexDone?.completed_on) ng("13 completed_on auto");
  ok("13 resolve to done", `completed_on=${indexDone.completed_on}`);

  // 14 conflict
  try {
    await executeComplaintUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...doneInput, title: `${title}_conflict` },
    });
    ng("14 should conflict");
  } catch (e) {
    if (!isComplaintSyncError(e) || e.code !== "conflict") ng("14 not conflict");
    ok("14 optimistic lock conflict");
  }

  // 15 notion_done resume
  // completedOn は done ポリシーで自動設定済み。hash は実行時と同じ値にする。
  const resumeReq = newRequestId();
  const resumeInput: ComplaintWriteInput = {
    ...doneInput,
    title: `${title}_resume`,
    completedOn: indexDone.completed_on as string,
  };
  await supabase.from("write_operations").insert({
    request_id: resumeReq,
    entity_type: "complaint",
    operation: "update",
    external_id: externalId,
    input_hash: hashComplaintWriteInput(resumeInput),
    status: "notion_done",
    notion_page_id: created.notionPageId!,
    recovery_payload: null,
    actor_id: actor.id,
  } as never);
  const pagesBeforeResume = await countPagesByExternalId(
    notion,
    complaintsDs,
    externalId,
  );
  const resumed = await executeComplaintUpdate(baseDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: "ignored-for-resume",
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("15 resume");
  if (
    (await countPagesByExternalId(notion, complaintsDs, externalId)) !==
    pagesBeforeResume
  ) {
    ng("15 resume created page");
  }
  ok("15 notion_done resume");

  // 16 ambiguous create recover
  const ambExt = newRequestId();
  const ambReq = newRequestId();
  const ambInput: ComplaintWriteInput = {
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
  const ambDeps = await buildComplaintDeps(
    ambNotion,
    supabase as Admin,
    complaintsDs,
  );
  const ambResult = await executeComplaintCreate(ambDeps, {
    requestId: ambReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambExt,
    input: ambInput,
  });
  if (ambResult.status !== "completed" || !ambResult.notionPageId) {
    ng("16 amb create recover");
  }
  if (ambPageId && ambResult.notionPageId !== ambPageId) ng("16 page mismatch");
  ok("16 ambiguous create recovered", `page=${maskId(ambResult.notionPageId!)}`);

  // 17 ambiguous update recover (title only)
  const pageForAmbU = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const currentForAmbU = await loadComplaintDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  const ambUReq = newRequestId();
  const ambUInput: ComplaintWriteInput = {
    title: `${title}_amb_upd`,
    customerPageId: currentForAmbU.customerPageId ?? customerPageId,
    dealPageId: currentForAmbU.dealPageId,
    severityPageId: currentForAmbU.severityPageId,
    statusPageId: currentForAmbU.statusPageId,
    staffPageId: currentForAmbU.staffPageId,
    occurredOn: currentForAmbU.occurredOn,
    summary: currentForAmbU.summary,
    dueDate: currentForAmbU.dueDate,
    completedOn: currentForAmbU.completedOn,
    note: currentForAmbU.note,
    content: currentForAmbU.content,
    cause: currentForAmbU.cause,
    response: currentForAmbU.response,
    prevention: currentForAmbU.prevention,
  };
  const ambUNotion = proxyPages(notion, {
    update: async (args) => {
      await notion.pages.update(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-u");
    },
  });
  const ambUDeps = await buildComplaintDeps(
    ambUNotion,
    supabase as Admin,
    complaintsDs,
  );
  const ambU = await executeComplaintUpdate(ambUDeps, {
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
    ng("17 amb update", ambU.status);
  }
  if (ambU.status === "notion_done") {
    const resumedAmb = await executeComplaintUpdate(baseDeps, {
      requestId: ambUReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "ignored",
      input: ambUInput,
    });
    if (resumedAmb.status !== "completed") {
      ng("17 amb update resume", resumedAmb.status);
    }
  }
  ok("17 ambiguous update recovered");

  // 18 master rejects
  try {
    await prepareComplaintWrite({
      data: {
        ...input,
        severityPageId: "99999999-9999-4999-8999-999999999999",
      },
      db: supabase,
    });
    ng("18 should reject bad severity");
  } catch (e) {
    if (!isComplaintSyncError(e)) ng("18 not sync error");
    ok("18 reject bad master");
  }

  // 19 deal customer mismatch
  const { data: otherDeal } = await supabase
    .from("deal_index")
    .select("notion_page_id")
    .neq("customer_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (otherDeal?.notion_page_id) {
    try {
      await prepareComplaintWrite({
        data: { ...input, dealPageId: otherDeal.notion_page_id },
        db: supabase,
      });
      ng("19 should reject other-customer deal");
    } catch (e) {
      if (!isComplaintSyncError(e)) ng("19 not sync error");
      ok("19 reject deal customer mismatch");
    }
  } else {
    skip("19 deal customer mismatch", "no other deal; unit tests cover");
  }

  // 20 inactive retain
  if (statusInactive) {
    const statusProp = baseDeps.propertiesByName["対応状況"];
    if (!statusProp) ng("20 status prop missing");
    await notion.pages.update({
      page_id: created.notionPageId!,
      properties: {
        [statusProp.id]: { relation: [{ id: statusInactive }] },
      },
    } as never);
    const pageAfterDirect = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    const currentRetain = await loadComplaintDomain(
      notion,
      created.notionPageId!,
      baseDeps.propertiesByName,
    );
    const retainInput: ComplaintWriteInput = {
      title: currentRetain.title,
      customerPageId: currentRetain.customerPageId ?? customerPageId,
      dealPageId: currentRetain.dealPageId,
      severityPageId: currentRetain.severityPageId,
      statusPageId: statusInactive,
      staffPageId: currentRetain.staffPageId,
      occurredOn: currentRetain.occurredOn,
      summary: currentRetain.summary,
      dueDate: currentRetain.dueDate,
      completedOn: currentRetain.completedOn,
      note: "inactive retain e2e",
      content: currentRetain.content,
      cause: currentRetain.cause,
      response: currentRetain.response,
      prevention: currentRetain.prevention,
    };
    try {
      await prepareComplaintWrite({
        data: retainInput,
        db: supabase,
        context: {
          current: {
            customerPageId: currentRetain.customerPageId,
            dealPageId: currentRetain.dealPageId,
            severityPageId: currentRetain.severityPageId,
            statusPageId: statusInactive,
            staffPageId: currentRetain.staffPageId,
          },
        },
      });
      const retainUpd = await executeComplaintUpdate(baseDeps, {
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
      if (retainUpd.status !== "completed") ng("20 inactive retain update");
      ok("20 inactive status retain");
    } catch (e) {
      ng(
        "20 inactive retain",
        isComplaintSyncError(e) ? e.code : "unexpected",
      );
    }
  } else {
    skip(
      "20 inactive retain",
      "inactive クレーム対応状況 missing; unit tests cover",
    );
  }

  // 21 not in_trash
  const finalPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  if ((finalPage as { in_trash?: boolean }).in_trash) ng("21 in_trash");
  ok("21 not in_trash");

  console.log("## E2E complaint PASS");
}

main().catch((e) => {
  console.error("E2E complaint FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

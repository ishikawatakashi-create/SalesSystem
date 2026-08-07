/**
 * Phase 5 対応履歴一括登録 E2E。
 * 3行中1行 validation 失敗 → 失敗行のみ再試行、成功行は重複なし。
 *
 * Usage: npx tsx scripts/e2e-activity-bulk.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "@notionhq/client";

import { createNotionClient } from "../src/lib/notion/client-core";
import { SupabaseNotionRateLimiter } from "../src/lib/notion/rate-limiter-core";
import { newRequestId, uuidV5 } from "../src/lib/notion/ids";
import { SCHEMA_SNAPSHOT_KEY } from "../src/lib/notion/setup/apply";
import type { PropertyIdMap } from "../src/lib/notion/converters/activity";
import type {
  ActivityWriteInput,
  WriteOperationRow,
} from "../src/lib/activities/types";
import {
  executeActivityCreate,
  type ActivityWriteDeps,
} from "../src/lib/sync/activity-write-pipeline-core";
import { prepareActivityWrite } from "../src/lib/activities/write-schema";
import { isActivitySyncError } from "../src/lib/sync/errors";
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

type Admin = { from: (table: string) => any };

async function loadActivityProps(admin: Admin): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: {
        activities: {
          properties: Record<string, { id: string; type: string }>;
        };
      };
    }
  ).databases.activities.properties;
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function buildDeps(
  notion: Client,
  admin: Admin,
  activitiesDs: string,
): Promise<ActivityWriteDeps> {
  return {
    notion,
    activitiesDataSourceId: activitiesDs,
    propertiesByName: await loadActivityProps(admin),
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
    },
    index: {
      async upsert(row) {
        const { error } = await admin.from("activity_index").upsert(row as never);
        if (error) throw new Error(error.message);
      },
      async getCustomerDisplayName(customerPageId) {
        const { data } = await admin
          .from("customer_index")
          .select("display_name")
          .eq("notion_page_id", customerPageId)
          .maybeSingle();
        return (data?.display_name as string | undefined) ?? null;
      },
      async getContactNames() {
        return [];
      },
      async getDealTitle() {
        return null;
      },
      async getCategoryNames() {
        return [];
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
          batch_id: input.batchId ?? null,
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
    latestActivityRecalc: {
      async requestForCustomers() {
        /* covered in e2e-activity-write */
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

async function countByExternal(
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

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const batchId = newRequestId();
  console.log(`## E2E activity-bulk start batch=${maskId(batchId)}`);

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
    .select("notion_page_id")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .limit(1)
    .maybeSingle();
  if (!customer?.notion_page_id) ng("fixture customer");
  const customerPageId = customer.notion_page_id as string;

  const { data: cats } = await supabase
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "対応履歴分類")
    .eq("is_active", true)
    .limit(1);
  const categoryId = cats?.[0]?.notion_page_id as string | undefined;
  if (!categoryId) ng("category missing");

  const deps = await buildDeps(notion, supabase as Admin, activitiesDs);

  type RowPlan = {
    rowId: string;
    requestId: string;
    title: string;
    forceBadCategory?: boolean;
  };
  const rows: RowPlan[] = [
    {
      rowId: "row-1",
      requestId: newRequestId(),
      title: `test_phase5_activity_bulk_${suffix}_1`,
    },
    {
      rowId: "row-2",
      requestId: newRequestId(),
      title: `test_phase5_activity_bulk_${suffix}_2`,
      forceBadCategory: true,
    },
    {
      rowId: "row-3",
      requestId: newRequestId(),
      title: `test_phase5_activity_bulk_${suffix}_3`,
    },
  ];

  const results: Array<{
    rowId: string;
    status: string;
    externalId: string;
    notionPageId: string | null;
  }> = [];

  for (const row of rows) {
    const externalId = uuidV5(
      `activity:bulk:${batchId}:${row.rowId}:${customerPageId}`,
    );
    const raw = {
      title: row.title,
      customerPageId,
      dealPageId: null as string | null,
      contactPageIds: [] as string[],
      activityAt: "2026-08-07T04:00:00.000Z",
      categoryPageIds: row.forceBadCategory
        ? ["99999999-9999-4999-8999-999999999999"]
        : [categoryId],
      summary: null as string | null,
      nextActionNote: null as string | null,
      nextActionDate: null as string | null,
      body: `bulk body ${row.rowId}`,
      batchId,
    };
    try {
      const write = await prepareActivityWrite({ data: raw, db: supabase });
      const created = await executeActivityCreate(deps, {
        requestId: row.requestId,
        actorId: actor.id,
        actorName: actor.display_name,
        externalId,
        input: write,
      });
      results.push({
        rowId: row.rowId,
        status: created.status,
        externalId,
        notionPageId: created.notionPageId,
      });
    } catch (e) {
      if (!isActivitySyncError(e) && !(e instanceof Error)) throw e;
      results.push({
        rowId: row.rowId,
        status: "error",
        externalId,
        notionPageId: null,
      });
    }
  }

  const okRows = results.filter((r) => r.status === "completed");
  const errRows = results.filter((r) => r.status === "error");
  if (okRows.length !== 2) ng("1-6 success count", String(okRows.length));
  if (errRows.length !== 1 || errRows[0]?.rowId !== "row-2") ng("1-6 fail row");
  if (new Set(results.map((r) => r.externalId)).size !== 3) {
    ng("3 distinct external_id");
  }
  for (const r of okRows) {
    if ((await countByExternal(notion, activitiesDs, r.externalId)) !== 1) {
      ng("2 independent pages", r.rowId);
    }
  }
  ok("1-6 first pass", `ok=${okRows.length} err=${errRows.length}`);

  const fail = rows.find((r) => r.rowId === "row-2")!;
  const failExt = uuidV5(
    `activity:bulk:${batchId}:${fail.rowId}:${customerPageId}`,
  );
  const retryWrite = (await prepareActivityWrite({
    data: {
      title: fail.title,
      customerPageId,
      activityAt: "2026-08-07T04:00:00.000Z",
      categoryPageIds: [categoryId],
      body: `bulk body ${fail.rowId} retry`,
      batchId,
    },
    db: supabase,
  })) as ActivityWriteInput;
  const retry = await executeActivityCreate(deps, {
    requestId: fail.requestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: failExt,
    input: retryWrite,
  });
  if (retry.status !== "completed") ng("7 retry failed row");
  ok("7-8 retry failed only");

  for (const r of okRows) {
    if ((await countByExternal(notion, activitiesDs, r.externalId)) !== 1) {
      ng("8 no dup on success rows", r.rowId);
    }
  }
  if ((await countByExternal(notion, activitiesDs, failExt)) !== 1) {
    ng("8 retry page count");
  }
  ok("8-9 no dup / row results accurate");

  const { data: cust } = await supabase
    .from("customer_index")
    .select("latest_activity_summary")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  ok(
    "10 customer index intact",
    `summaryLen=${String(cust?.latest_activity_summary ?? "").length}`,
  );

  console.log("## E2E activity-bulk PASS");
}

main().catch((err) => {
  console.error(
    "E2E activity-bulk FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});

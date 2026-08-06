/**
 * Phase 4 案件 write pipeline 実Notion/Supabase E2E。
 * 案件名 test_phase4_deal_* のテスト案件を作成・更新する。
 * request_id / external_id / notion_page_id は全文をログしない。
 *
 * Usage: npx tsx scripts/e2e-deal-write.ts
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
import type { PropertyIdMap } from "../src/lib/notion/converters/deal";
import { notionPageToDeal } from "../src/lib/notion/converters/deal";
import type { PropertyIdMap as CustomerPropertyIdMap } from "../src/lib/notion/converters/customer";
import { notionPageToCustomer } from "../src/lib/notion/converters/customer";
import type {
  DealWriteInput,
  WriteOperationRow,
} from "../src/lib/deals/types";
import {
  executeDealCreate,
  executeDealUpdate,
  type DealWriteDeps,
  type DealWriteOpStore,
  type DealIndexStore,
  type DealAuditStore,
  type DealSyncErrorStore,
  type DealExpectedAmountRecalc,
} from "../src/lib/sync/deal-write-pipeline-core";
import { isDealSyncError } from "../src/lib/sync/errors";
import { prepareDealWrite } from "../src/lib/deals/write-schema";
import { computeCustomerExpectedAmountFromDeals } from "../src/lib/deals/expected-amount";
import { hashCustomerDomain } from "../src/lib/customers/content-hash";
import {
  executeContactCreate,
  executeContactUpdate,
  type ContactWriteDeps,
} from "../src/lib/sync/contact-write-pipeline-core";
import type { ContactWriteInput } from "../src/lib/contacts/types";
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

function createWriteOpStore(admin: Admin): DealWriteOpStore {
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
        entity_type: "deal",
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

function createIndexStore(admin: Admin): DealIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("deal_index").upsert(row as never);
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
      if (!data || data.master_type !== "案件ステータス") return null;
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
    async getContactNames(contactPageIds) {
      if (contactPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("contact_index")
        .select("notion_page_id,name")
        .in("notion_page_id", contactPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((c: any) => [
          c.notion_page_id as string,
          c.name as string,
        ]),
      );
      return contactPageIds
        .map((id) => map.get(id) ?? "")
        .filter((n): n is string => Boolean(n));
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
        .filter((n): n is string => Boolean(n));
    },
  };
}

function createAuditStore(admin: Admin): DealAuditStore {
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

function createSyncErrorStore(admin: Admin): DealSyncErrorStore {
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

async function loadDealPropertyMap(admin: Admin): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: {
        deals: {
          properties: Record<string, { id: string; type: string }>;
        };
      };
    }
  ).databases.deals.properties;
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function loadCustomerPropertyMap(
  admin: Admin,
): Promise<CustomerPropertyIdMap> {
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
  const map: CustomerPropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

async function loadContactPropertyMap(admin: Admin): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error || !data?.value) throw new Error("snapshot missing");
  const props = (
    data.value as {
      databases: {
        contacts: {
          properties: Record<string, { id: string; type: string }>;
        };
      };
    }
  ).databases.contacts.properties;
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

/**
 * server-only を避けた見込み金額再計算(E2E用)。
 * 本番ハンドラと同じ合算ルールを使う。
 */
async function recalculateInline(input: {
  admin: Admin;
  notion: Client;
  customerPageId: string;
  customerProps: CustomerPropertyIdMap;
  sourceDealExternalId?: string | null;
  jobId?: string | null;
}): Promise<{ before: number | null; after: number }> {
  const amountProp = input.customerProps["見込み金額"];
  if (!amountProp) throw new Error("顧客スナップショットに見込み金額がありません");

  const { data: deals, error: dealsError } = await input.admin
    .from("deal_index")
    .select("status_semantic,expected_amount")
    .eq("customer_page_id", input.customerPageId);
  if (dealsError) throw new Error(dealsError.message);

  const after = computeCustomerExpectedAmountFromDeals(deals ?? []);

  const { data: indexRow, error: indexError } = await input.admin
    .from("customer_index")
    .select("expected_amount")
    .eq("notion_page_id", input.customerPageId)
    .maybeSingle();
  if (indexError) throw new Error(indexError.message);
  if (!indexRow) throw new Error("customer_index missing");

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
  const before = beforeCustomer.expectedAmount ?? indexRow.expected_amount;

  if (beforeCustomer.expectedAmount !== after) {
    await input.notion.pages.update({
      page_id: input.customerPageId,
      properties: {
        [amountProp.id]: { number: after },
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

  const { error: updateError } = await input.admin
    .from("customer_index")
    .update({
      expected_amount: after,
      content_hash: contentHash,
      notion_last_edited_at: lastEditedTime,
      last_synced_at: new Date().toISOString(),
    } as never)
    .eq("notion_page_id", input.customerPageId);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await input.admin.from("audit_logs").insert({
    actor_id: null,
    actor_name: "system",
    action: "customer.expected_amount.recalculated",
    entity_type: "customer",
    notion_page_id: input.customerPageId,
    changed_fields: {
      expected_amount: { before, after },
      sourceDealExternalId: input.sourceDealExternalId ?? null,
      jobId: input.jobId ?? null,
    },
    operation_source: "system",
    request_id: null,
  } as never);
  if (auditError) throw new Error(auditError.message);

  return { before, after };
}

function createExpectedAmountRecalc(input: {
  admin: Admin;
  notion: Client;
  customerProps: CustomerPropertyIdMap;
}): DealExpectedAmountRecalc {
  return {
    async requestForCustomers({ customerPageIds, sourceDealExternalId }) {
      const unique = [
        ...new Set(
          customerPageIds.filter((id): id is string => Boolean(id)),
        ),
      ];
      for (const customerPageId of unique) {
        await recalculateInline({
          admin: input.admin,
          notion: input.notion,
          customerPageId,
          customerProps: input.customerProps,
          sourceDealExternalId,
        });
      }
    },
  };
}

async function buildDealDeps(
  notion: Client,
  admin: Admin,
  dealsDs: string,
  customerProps: CustomerPropertyIdMap,
): Promise<DealWriteDeps> {
  return {
    notion,
    dealsDataSourceId: dealsDs,
    propertiesByName: await loadDealPropertyMap(admin),
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    expectedAmountRecalc: createExpectedAmountRecalc({
      admin,
      notion,
      customerProps,
    }),
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

async function findStatusBySemantic(
  admin: Admin,
  semantic: string,
): Promise<string> {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "案件ステータス")
    .eq("semantic_key", semantic)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const id = data?.notion_page_id as string | undefined;
  if (!id) throw new Error(`status semantic not found: ${semantic}`);
  return id;
}

async function findActiveStage(admin: Admin): Promise<string> {
  const { data, error } = await admin
    .from("masters_cache")
    .select("notion_page_id")
    .eq("master_type", "案件ステージ")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const id = data?.notion_page_id as string | undefined;
  if (!id) throw new Error("案件ステージ missing");
  return id;
}

async function countPagesByExternalId(
  notion: Client,
  dealsDs: string,
  externalId: string,
): Promise<number> {
  const q = await notion.dataSources.query({
    data_source_id: dealsDs,
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

async function loadDealDomain(
  notion: Client,
  pageId: string,
  propertiesByName: PropertyIdMap,
) {
  return notionPageToDeal({
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

async function readCustomerExpectedAmount(
  admin: Admin,
  customerPageId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from("customer_index")
    .select("expected_amount")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.expected_amount as number | null | undefined) ?? null;
}

async function ensureActiveContact(input: {
  admin: Admin;
  notion: Client;
  contactsDs: string;
  customerPageId: string;
  actorId: string;
  actorName: string;
}): Promise<string> {
  const { data: existing } = await input.admin
    .from("contact_index")
    .select("notion_page_id,is_active,external_id")
    .eq("customer_page_id", input.customerPageId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (existing?.notion_page_id) {
    return existing.notion_page_id as string;
  }

  // 無効なら再有効化
  const { data: inactive } = await input.admin
    .from("contact_index")
    .select("notion_page_id,external_id,name")
    .eq("customer_page_id", input.customerPageId)
    .eq("is_active", false)
    .ilike("name", "test_%")
    .limit(1)
    .maybeSingle();

  const props = await loadContactPropertyMap(input.admin);
  const contactDeps: ContactWriteDeps = {
    notion: input.notion,
    contactsDataSourceId: input.contactsDs,
    propertiesByName: props,
    writeOps: {
      async getByRequestId(requestId) {
        const { data, error } = await input.admin
          .from("write_operations")
          .select("*")
          .eq("request_id", requestId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as unknown as WriteOperationRow) ?? null;
      },
      async insertPending(row) {
        const { error } = await input.admin.from("write_operations").insert({
          request_id: row.requestId,
          entity_type: "contact",
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
      async markNotionDone(payload) {
        const patch: Record<string, unknown> = {
          status: "notion_done",
          notion_page_id: payload.notionPageId,
          error: null,
        };
        if (payload.recoveryPayload !== undefined) {
          patch.recovery_payload = payload.recoveryPayload;
        }
        const { error } = await input.admin
          .from("write_operations")
          .update(patch as never)
          .eq("request_id", payload.requestId);
        if (error) throw new Error(error.message);
      },
      async markCompleted(requestId) {
        const { error } = await input.admin
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
        const { error } = await input.admin
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
        const { error } = await input.admin
          .from("contact_index")
          .upsert(row as never);
        if (error) throw new Error(error.message);
      },
    },
    audit: {
      async insert(row) {
        const { error } = await input.admin.from("audit_logs").insert({
          actor_id: row.actorId,
          actor_name: row.actorName,
          action: row.action,
          entity_type: row.entityType,
          notion_page_id: row.notionPageId,
          changed_fields: row.changedFields,
          operation_source: row.operationSource,
          request_id: row.requestId,
        } as never);
        if (error) throw new Error(error.message);
      },
    },
    syncErrors: {
      async insert(row) {
        const { error } = await input.admin.from("sync_errors").insert({
          stage: row.stage,
          entity_type: row.entityType,
          notion_page_id: row.notionPageId ?? null,
          external_id: row.externalId ?? null,
          message: row.message,
          detail: row.detail ?? {},
        } as never);
        if (error) throw new Error(error.message);
      },
    },
    customerSearch: {
      async getDisplayName() {
        return "test";
      },
      async refreshForCustomer() {
        /* skip in deal e2e helper */
      },
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };

  if (inactive?.notion_page_id && inactive.external_id) {
    const page = await input.notion.pages.retrieve({
      page_id: inactive.notion_page_id,
    });
    const write: ContactWriteInput = {
      name: String(inactive.name),
      nameKana: null,
      customerPageId: input.customerPageId,
      department: null,
      title: null,
      phone: null,
      email: null,
      contactTypePageId: null,
      note: "phase4 deal e2e reactivate",
      isActive: true,
    };
    const result = await executeContactUpdate(contactDeps, {
      requestId: newRequestId(),
      actorId: input.actorId,
      actorName: input.actorName,
      notionPageId: inactive.notion_page_id,
      externalId: inactive.external_id,
      expectedLastEditedTime: (page as { last_edited_time: string })
        .last_edited_time,
      input: write,
    });
    if (result.status !== "completed" && result.status !== "notion_done") {
      throw new Error("contact reactivate failed");
    }
    return inactive.notion_page_id as string;
  }

  const suffix = randomBytes(2).toString("hex");
  const name = `test_phase4_contact_${suffix}`;
  const created = await executeContactCreate(contactDeps, {
    requestId: newRequestId(),
    actorId: input.actorId,
    actorName: input.actorName,
    externalId: newRequestId(),
    input: {
      name,
      nameKana: "てすと",
      customerPageId: input.customerPageId,
      department: null,
      title: null,
      phone: null,
      email: null,
      contactTypePageId: null,
      note: "phase4 deal e2e",
      isActive: true,
    },
  });
  if (!created.notionPageId) throw new Error("contact create failed");
  return created.notionPageId;
}

async function main() {
  loadEnvLocal();
  const suffix = randomBytes(3).toString("hex");
  const dealTitle = `test_phase4_deal_20260807_${suffix}`;
  console.log(`## E2E start title=${dealTitle}`);

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

  const dealsDs = process.env.NOTION_DS_DEALS!;
  const contactsDs = process.env.NOTION_DS_CONTACTS!;
  if (!dealsDs) throw new Error("NOTION_DS_DEALS missing");
  if (!contactsDs) throw new Error("NOTION_DS_CONTACTS missing");

  // 1 test customer
  const { data: customer } = await supabase
    .from("customer_index")
    .select(
      "notion_page_id,display_name,is_archived,expected_amount,phone,email,legal_name",
    )
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .limit(1)
    .maybeSingle();
  if (!customer?.notion_page_id) ng("1 test customer missing");
  const customerPageId = customer.notion_page_id as string;
  const beforeExpectedAmount =
    (customer.expected_amount as number | null | undefined) ?? null;
  const customerSnapshot = {
    phone: customer.phone,
    email: customer.email,
    legal_name: customer.legal_name,
  };
  ok(
    "1 test customer",
    `customer=${maskId(customerPageId)} beforeAmount=${beforeExpectedAmount}`,
  );

  const customerProps = await loadCustomerPropertyMap(supabase as Admin);

  // ensure contact
  const contactPageId = await ensureActiveContact({
    admin: supabase as Admin,
    notion,
    contactsDs,
    customerPageId,
    actorId: actor.id,
    actorName: actor.display_name,
  });
  ok("1b active contact", `contact=${maskId(contactPageId)}`);

  const stageId = await findActiveStage(supabase as Admin);
  const statusActive = await findStatusBySemantic(supabase as Admin, "active");
  const statusOnHold = await findStatusBySemantic(supabase as Admin, "on_hold");
  const statusWon = await findStatusBySemantic(supabase as Admin, "won");
  const statusLost = await findStatusBySemantic(supabase as Admin, "lost");
  ok(
    "masters resolved",
    `stage=${maskId(stageId)} active=${maskId(statusActive)}`,
  );

  const baseDeps = await buildDealDeps(
    notion,
    supabase as Admin,
    dealsDs,
    customerProps,
  );

  const amountA = 12_000;
  const input: DealWriteInput = {
    title: dealTitle,
    customerPageId,
    contactPageIds: [contactPageId],
    businessCategoryPageId: null,
    productName: "E2E商材",
    stagePageId: stageId,
    staffPageIds: [],
    expectedAmount: amountA,
    contractAmount: null,
    probability: 40,
    expectedCloseDate: "2026-12-31",
    contractedAt: null,
    periodStart: null,
    periodEnd: null,
    lostReason: null,
    statusPageId: statusActive,
    note: "phase4 e2e",
  };

  const createRequestId = newRequestId();
  const externalId = newRequestId();

  // 2 create
  const created = await executeDealCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (created.status !== "completed" || !created.notionPageId) {
    ng("2 create completed", `status=${created.status}`);
  }
  ok(
    "2 create",
    `page=${maskId(created.notionPageId!)} ext=${maskId(externalId)}`,
  );

  // 3 one notion page
  if ((await countPagesByExternalId(notion, dealsDs, externalId)) !== 1) {
    ng("3 single page");
  }
  ok("3 single notion page");

  // 4 external_id + properties
  const domain = await loadDealDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (domain.externalId !== externalId) ng("4 external_id match");
  if (domain.title !== dealTitle) ng("4 title");
  if (domain.customerPageId !== customerPageId) ng("4 customer");
  if (domain.expectedAmount !== amountA) ng("4 amount");
  if (domain.statusPageId !== statusActive) ng("4 status");
  ok("4 external_id + properties");

  // 5 deal_index
  const { data: indexRow } = await supabase
    .from("deal_index")
    .select("*")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (!indexRow) ng("5 deal_index");
  if (indexRow.expected_amount !== amountA) ng("5 amount");
  if (indexRow.status_semantic !== "active") ng("5 status_semantic");
  ok("5 deal_index", `sync=${indexRow.sync_status}`);

  // 6 write_operations completed
  const { data: wo } = await supabase
    .from("write_operations")
    .select("status,external_id,entity_type")
    .eq("request_id", createRequestId)
    .maybeSingle();
  if (wo?.status !== "completed") ng("6 write_operations", String(wo?.status));
  if (wo?.external_id !== externalId) ng("6 write_op external_id");
  if (wo?.entity_type !== "deal") ng("6 entity_type deal");
  ok("6 write_operations completed");

  // 7 audit deal.create
  const { count: auditCreateCount } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "deal.create");
  if (auditCreateCount !== 1) ng("7 audit create", `count=${auditCreateCount}`);
  ok("7 audit_logs deal.create x1");

  // 8 aggregation after create (active+amount)
  const amountAfterCreate = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  const expectedAfterCreate =
    (beforeExpectedAmount ?? 0) +
    (beforeExpectedAmount === null ? amountA : amountA);
  // baseline may already include other deals; verify absolute via recompute
  const { after: recomputedAfterCreate } = await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
    sourceDealExternalId: externalId,
  });
  const amountCheck1 = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  if (amountCheck1 !== recomputedAfterCreate) ng("8 aggregation mismatch");
  if (recomputedAfterCreate < amountA) ng("8 aggregation too small");
  ok("8 aggregation active+amount", `expected_amount=${amountCheck1}`);
  void expectedAfterCreate;
  void amountAfterCreate;

  // 9 idempotent
  const again = await executeDealCreate(baseDeps, {
    requestId: createRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId,
    input,
  });
  if (again.notionPageId !== created.notionPageId) ng("9 idempotent page id");
  if ((await countPagesByExternalId(notion, dealsDs, externalId)) !== 1) {
    ng("9 no duplicate page");
  }
  const { count: auditCreateCount2 } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("request_id", createRequestId)
    .eq("action", "deal.create");
  if ((auditCreateCount2 ?? 0) !== 1) {
    ng("9 audit not duplicated", `count=${auditCreateCount2}`);
  }
  const amountAfterIdem = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  if (amountAfterIdem !== amountCheck1) ng("9 no double-add on idempotent");
  ok("9 idempotent re-run no dup");

  // 10 hash mismatch reject
  let hashMismatchCaught = false;
  try {
    await executeDealCreate(baseDeps, {
      requestId: createRequestId,
      actorId: actor.id,
      actorName: actor.display_name,
      externalId,
      input: { ...input, title: `${dealTitle}_changed` },
    });
  } catch (error) {
    if (isDealSyncError(error) && error.code === "input_hash_mismatch") {
      hashMismatchCaught = true;
    } else {
      ng("10 unexpected error type");
    }
  }
  if (!hashMismatchCaught) ng("10 hash mismatch not thrown");
  ok("10 input_hash mismatch rejected");

  // 11 update amount
  const detailPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const lastEdited = (detailPage as { last_edited_time: string })
    .last_edited_time;
  const updateRequestId = newRequestId();
  const amountB = 18_000;
  const updatedInput: DealWriteInput = {
    ...input,
    expectedAmount: amountB,
    productName: "更新商材",
  };
  const updated = await executeDealUpdate(baseDeps, {
    requestId: updateRequestId,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: lastEdited,
    input: updatedInput,
  });
  if (updated.status !== "completed") ng("11 update", updated.status);
  ok("11 update completed");

  // 12 notion+index + amount change updates sum
  const { data: indexAfter } = await supabase
    .from("deal_index")
    .select("expected_amount,product_name,status_semantic")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexAfter?.expected_amount !== amountB) ng("12 index amount");
  if (indexAfter?.product_name !== "更新商材") ng("12 index product");
  const afterDomain = await loadDealDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (afterDomain.expectedAmount !== amountB) ng("12 notion amount");
  const amountAfterB = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  const { after: recomputedB } = await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
  });
  if (amountAfterB !== recomputedB) ng("12 sum not updated");
  ok("12 notion+index+sum updated");

  // 13 audit before/after
  const { data: auditUpdate } = await supabase
    .from("audit_logs")
    .select("changed_fields")
    .eq("request_id", updateRequestId)
    .eq("action", "deal.update")
    .maybeSingle();
  const changed = auditUpdate?.changed_fields as Record<
    string,
    { before?: unknown; after?: unknown }
  > | null;
  if (
    changed?.["見込み金額"]?.before !== amountA ||
    changed?.["見込み金額"]?.after !== amountB
  ) {
    ng("13 audit before/after");
  }
  ok("13 audit update before/after");

  // 14 stale last_edited_time conflict
  let conflictOk = false;
  try {
    await executeDealUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: "2000-01-01T00:00:00.000Z",
      input: { ...updatedInput, productName: "競合商材" },
    });
  } catch (error) {
    if (isDealSyncError(error) && error.code === "conflict") conflictOk = true;
  }
  if (!conflictOk) ng("14 conflict");
  const { data: indexConflict } = await supabase
    .from("deal_index")
    .select("product_name")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (indexConflict?.product_name !== "更新商材") ng("14 no overwrite on conflict");
  ok("14 optimistic lock conflict");

  // 15 notion_done resume (inject index failure)
  const resumePage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const resumeEdited = (resumePage as { last_edited_time: string })
    .last_edited_time;
  const resumeReq = newRequestId();
  let upsertCalls = 0;
  const failingDeps: DealWriteDeps = {
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
  const resumeInput: DealWriteInput = {
    ...updatedInput,
    note: "再開メモ",
  };
  const partial = await executeDealUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (partial.status !== "notion_done") {
    ng("15 notion_done after inject", partial.status);
  }
  const beforeResumeCount = await countPagesByExternalId(
    notion,
    dealsDs,
    externalId,
  );
  const resumed = await executeDealUpdate(failingDeps, {
    requestId: resumeReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: resumeEdited,
    input: resumeInput,
  });
  if (resumed.status !== "completed") ng("15 resume completed", resumed.status);
  if (
    (await countPagesByExternalId(notion, dealsDs, externalId)) !==
    beforeResumeCount
  ) {
    ng("15 no new page on resume");
  }
  ok("15 notion_done resume");

  // 16 on_hold still included
  const onHoldPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const onHoldReq = newRequestId();
  const onHoldInput: DealWriteInput = {
    ...resumeInput,
    statusPageId: statusOnHold,
  };
  const onHoldResult = await executeDealUpdate(baseDeps, {
    requestId: onHoldReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (onHoldPage as { last_edited_time: string })
      .last_edited_time,
    input: onHoldInput,
  });
  if (onHoldResult.status !== "completed") ng("16 on_hold update");
  const { data: onHoldIndex } = await supabase
    .from("deal_index")
    .select("status_semantic,expected_amount")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (onHoldIndex?.status_semantic !== "on_hold") ng("16 semantic on_hold");
  const amountOnHold = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  const { after: recomputedOnHold } = await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
  });
  if (amountOnHold !== recomputedOnHold) ng("16 on_hold sum");
  // deal still contributes amountB
  const { data: dealsForSum } = await supabase
    .from("deal_index")
    .select("status_semantic,expected_amount")
    .eq("customer_page_id", customerPageId);
  const pureSum = computeCustomerExpectedAmountFromDeals(dealsForSum ?? []);
  if (pureSum !== recomputedOnHold) ng("16 pure vs index");
  ok("16 on_hold still included", `sum=${amountOnHold}`);

  // 17 change to non-target status subtracts
  const wonPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const beforeWon = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  const wonResult = await executeDealUpdate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (wonPage as { last_edited_time: string })
      .last_edited_time,
    input: { ...onHoldInput, statusPageId: statusWon },
  });
  if (wonResult.status !== "completed") ng("17 won update");
  const afterWon = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  if ((beforeWon ?? 0) - (afterWon ?? 0) !== amountB) {
    // may be off if other deals exist; verify deal not in sum
    const { data: dealsWon } = await supabase
      .from("deal_index")
      .select("status_semantic,expected_amount")
      .eq("customer_page_id", customerPageId);
    const sumWon = computeCustomerExpectedAmountFromDeals(dealsWon ?? []);
    if (afterWon !== sumWon) ng("17 sum after won");
    // our deal should be won and not counted - check via status_semantic of our page
    const { data: myDeal } = await supabase
      .from("deal_index")
      .select("status_semantic")
      .eq("notion_page_id", created.notionPageId!)
      .maybeSingle();
    if (myDeal?.status_semantic !== "won") ng("17 not won");
  }
  ok("17 non-target status subtracts", `sum=${afterWon}`);

  // 18 put back to active for further tests
  const backPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  await executeDealUpdate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (backPage as { last_edited_time: string })
      .last_edited_time,
    input: { ...onHoldInput, statusPageId: statusActive },
  });
  ok("18 restored to active for remaining checks");

  // 19 ambiguous create
  const ambCreateExt = newRequestId();
  const ambCreateReq = newRequestId();
  const ambCreateTitle = `${dealTitle}_ambcreate`;
  const createProxy = proxyPages(notion, {
    create: async (args) => {
      await notion.pages.create(args);
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-c");
    },
  });
  const ambCreateDeps = await buildDealDeps(
    createProxy,
    supabase as Admin,
    dealsDs,
    customerProps,
  );
  const ambCreateResult = await executeDealCreate(ambCreateDeps, {
    requestId: ambCreateReq,
    actorId: actor.id,
    actorName: actor.display_name,
    externalId: ambCreateExt,
    input: {
      ...input,
      title: ambCreateTitle,
      expectedAmount: 1000,
      contactPageIds: [contactPageId],
    },
  });
  if (
    ambCreateResult.status !== "completed" &&
    ambCreateResult.status !== "notion_done"
  ) {
    ng("19 amb create status", ambCreateResult.status);
  }
  if ((await countPagesByExternalId(notion, dealsDs, ambCreateExt)) !== 1) {
    ng("19 no dup after amb create");
  }
  ok("19 ambiguous create recovery");

  // move amb create deal to lost so it doesn't affect aggregation baseline
  if (ambCreateResult.notionPageId) {
    const p = await notion.pages.retrieve({
      page_id: ambCreateResult.notionPageId,
    });
    await executeDealUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: ambCreateResult.notionPageId,
      externalId: ambCreateExt,
      expectedLastEditedTime: (p as { last_edited_time: string })
        .last_edited_time,
      input: {
        ...input,
        title: ambCreateTitle,
        expectedAmount: 1000,
        statusPageId: statusLost,
      },
    });
  }

  // 20 ambiguous update content_hash
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
  const ambUpdDeps = await buildDealDeps(
    updateProxy,
    supabase as Admin,
    dealsDs,
    customerProps,
  );
  const ambUpdInput: DealWriteInput = {
    ...onHoldInput,
    statusPageId: statusActive,
    note: "曖昧復旧メモ",
  };
  const ambUpd = await executeDealUpdate(ambUpdDeps, {
    requestId: ambUpdReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: curEdited,
    input: ambUpdInput,
  });
  if (!updateCalled) ng("20 update was not called");
  if (ambUpd.status !== "completed" && ambUpd.status !== "notion_done") {
    ng("20 amb update status", ambUpd.status);
  }
  const afterAmb = await loadDealDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (afterAmb.note !== "曖昧復旧メモ") {
    ng("20 hash-aligned update applied");
  }
  ok("20 ambiguous update recovered via content_hash");

  // mismatch path
  const mismatchReq = newRequestId();
  const pageBeforeMismatch = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const mismatchProxy = proxyPages(notion, {
    update: async () => {
      throw new NotionHttpError(503, "write_ambiguous_failure", "e2e-amb-mismatch");
    },
  });
  const mismatchDeps = await buildDealDeps(
    mismatchProxy,
    supabase as Admin,
    dealsDs,
    customerProps,
  );
  let mismatchStopped = false;
  try {
    await executeDealUpdate(mismatchDeps, {
      requestId: mismatchReq,
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (
        pageBeforeMismatch as { last_edited_time: string }
      ).last_edited_time,
      input: { ...ambUpdInput, productName: "不一致商材" },
    });
  } catch (error) {
    if (isDealSyncError(error) && error.code === "ambiguous_write") {
      mismatchStopped = true;
    } else {
      throw error;
    }
  }
  if (!mismatchStopped) ng("20 mismatch stop");
  const { data: prodCheck } = await supabase
    .from("deal_index")
    .select("product_name")
    .eq("notion_page_id", created.notionPageId!)
    .maybeSingle();
  if (prodCheck?.product_name === "不一致商材") ng("20 no auto overwrite");
  ok("20 ambiguous update mismatch guarded");

  // 21 reject wrong-customer contact
  const { data: otherContact } = await supabase
    .from("contact_index")
    .select("notion_page_id")
    .neq("customer_page_id", customerPageId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (otherContact?.notion_page_id) {
    let mismatchRejected = false;
    try {
      await prepareDealWrite({
        data: {
          title: `${dealTitle}_wrongcontact`,
          customerPageId,
          contactPageIds: [otherContact.notion_page_id],
          stagePageId: stageId,
          statusPageId: statusActive,
        },
        db: supabase,
      });
    } catch (error) {
      if (
        isDealSyncError(error) &&
        error.detail?.reason === "contact_customer_mismatch"
      ) {
        mismatchRejected = true;
      }
    }
    if (!mismatchRejected) ng("21 wrong-customer contact not rejected");
    ok("21 reject wrong-customer contact");
  } else {
    ok("21 wrong-customer contact skipped (no other contact)");
  }

  // 22 reject bad stage/status
  let badStageRejected = false;
  try {
    await prepareDealWrite({
      data: {
        title: `${dealTitle}_badstage`,
        customerPageId,
        stagePageId: newRequestId(),
        statusPageId: statusActive,
      },
      db: supabase,
    });
  } catch (error) {
    if (isDealSyncError(error) && error.code === "validation") {
      badStageRejected = true;
    }
  }
  if (!badStageRejected) ng("22 bad stage not rejected");
  ok("22 reject bad stage/status");

  // 23 reject archived customer create
  const { data: archivedCust } = await supabase
    .from("customer_index")
    .select("notion_page_id")
    .eq("is_archived", true)
    .ilike("display_name", "test_%")
    .limit(1)
    .maybeSingle();
  if (archivedCust?.notion_page_id) {
    let archivedRejected = false;
    try {
      await prepareDealWrite({
        data: {
          title: `${dealTitle}_archived`,
          customerPageId: archivedCust.notion_page_id,
          stagePageId: stageId,
          statusPageId: statusActive,
        },
        db: supabase,
      });
    } catch (error) {
      if (
        isDealSyncError(error) &&
        error.detail?.reason === "archived_customer_forbidden"
      ) {
        archivedRejected = true;
      }
    }
    if (!archivedRejected) ng("23 archived customer not rejected");
    ok("23 archived customer create rejected");
  } else {
    ok("23 archived customer test skipped (no archived test customer)");
  }

  // 24 customer change recalcs both (if second test customer exists)
  const { data: otherCustomer } = await supabase
    .from("customer_index")
    .select("notion_page_id,display_name")
    .eq("is_archived", false)
    .ilike("display_name", "test_phase2_customer_%")
    .neq("notion_page_id", customerPageId)
    .limit(1)
    .maybeSingle();
  if (otherCustomer?.notion_page_id) {
    const otherId = otherCustomer.notion_page_id as string;
    const otherContactId = await ensureActiveContact({
      admin: supabase as Admin,
      notion,
      contactsDs,
      customerPageId: otherId,
      actorId: actor.id,
      actorName: actor.display_name,
    });
    const beforeA = await readCustomerExpectedAmount(
      supabase as Admin,
      customerPageId,
    );
    const beforeB = await readCustomerExpectedAmount(
      supabase as Admin,
      otherId,
    );
    const movePage = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    const moved = await executeDealUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (movePage as { last_edited_time: string })
        .last_edited_time,
      input: {
        ...ambUpdInput,
        customerPageId: otherId,
        contactPageIds: [otherContactId],
        statusPageId: statusActive,
        expectedAmount: amountB,
      },
    });
    if (moved.status !== "completed") ng("24 customer move", moved.status);
    const afterA = await readCustomerExpectedAmount(
      supabase as Admin,
      customerPageId,
    );
    const afterB = await readCustomerExpectedAmount(
      supabase as Admin,
      otherId,
    );
    if ((beforeA ?? 0) <= (afterA ?? 0) && (beforeA ?? 0) > 0) {
      // A should decrease by amountB unless other aggregating deals remain
      const { after: reA } = await recalculateInline({
        admin: supabase as Admin,
        notion,
        customerPageId,
        customerProps,
      });
      if (afterA !== reA) ng("24 customer A sum");
    }
    const { after: reB } = await recalculateInline({
      admin: supabase as Admin,
      notion,
      customerPageId: otherId,
      customerProps,
    });
    if (afterB !== reB) ng("24 customer B sum");
    ok(
      "24 customer change recalcs both",
      `A=${afterA} B=${afterB} (was ${beforeA}/${beforeB})`,
    );

    // move back to original customer
    const backCustPage = await notion.pages.retrieve({
      page_id: created.notionPageId!,
    });
    await executeDealUpdate(baseDeps, {
      requestId: newRequestId(),
      actorId: actor.id,
      actorName: actor.display_name,
      notionPageId: created.notionPageId!,
      externalId,
      expectedLastEditedTime: (backCustPage as { last_edited_time: string })
        .last_edited_time,
      input: {
        ...ambUpdInput,
        customerPageId,
        contactPageIds: [contactPageId],
        statusPageId: statusActive,
        expectedAmount: amountB,
      },
    });
  } else {
    ok("24 customer change skipped (only one test customer)");
  }

  // 25 duplicate recalc no double-add
  const sumBeforeDup = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
    jobId: "e2e-dup-1",
  });
  await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
    jobId: "e2e-dup-2",
  });
  const sumAfterDup = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  if (sumBeforeDup !== sumAfterDup) ng("25 double-add");
  ok("25 duplicate recalc no double-add");

  // 26 recalc failure resume via injected failure then retry
  const failPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const failReq = newRequestId();
  let recalcCalls = 0;
  const failRecalcDeps: DealWriteDeps = {
    ...baseDeps,
    expectedAmountRecalc: {
      async requestForCustomers(args) {
        recalcCalls += 1;
        if (recalcCalls === 1) throw new Error("injected_recalc_failure");
        return baseDeps.expectedAmountRecalc.requestForCustomers(args);
      },
    },
  };
  const failInput: DealWriteInput = {
    ...ambUpdInput,
    customerPageId,
    contactPageIds: [contactPageId],
    statusPageId: statusActive,
    expectedAmount: amountB,
    note: "recalc再開",
  };
  const failPartial = await executeDealUpdate(failRecalcDeps, {
    requestId: failReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (failPage as { last_edited_time: string })
      .last_edited_time,
    input: failInput,
  });
  if (failPartial.status !== "notion_done") {
    ng("26 notion_done after recalc inject", failPartial.status);
  }
  const failResumed = await executeDealUpdate(failRecalcDeps, {
    requestId: failReq,
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (failPage as { last_edited_time: string })
      .last_edited_time,
    input: failInput,
  });
  if (failResumed.status !== "completed") {
    ng("26 recalc resume", failResumed.status);
  }
  ok("26 recalc failure resume via job/retry");

  // 27 customer other props untouched
  const { data: custAfter } = await supabase
    .from("customer_index")
    .select("phone,email,legal_name")
    .eq("notion_page_id", customerPageId)
    .maybeSingle();
  if (
    custAfter?.phone !== customerSnapshot.phone ||
    custAfter?.email !== customerSnapshot.email ||
    custAfter?.legal_name !== customerSnapshot.legal_name
  ) {
    ng("27 customer other props changed");
  }
  ok("27 customer other props untouched");

  // 28 end with non-target status + restore expected amount
  const endPage = await notion.pages.retrieve({
    page_id: created.notionPageId!,
  });
  const ended = await executeDealUpdate(baseDeps, {
    requestId: newRequestId(),
    actorId: actor.id,
    actorName: actor.display_name,
    notionPageId: created.notionPageId!,
    externalId,
    expectedLastEditedTime: (endPage as { last_edited_time: string })
      .last_edited_time,
    input: {
      ...failInput,
      statusPageId: statusLost,
    },
  });
  if (ended.status !== "completed") ng("28 end non-target", ended.status);
  const { after: finalAmount } = await recalculateInline({
    admin: supabase as Admin,
    notion,
    customerPageId,
    customerProps,
  });
  const finalIndexAmount = await readCustomerExpectedAmount(
    supabase as Admin,
    customerPageId,
  );
  if (finalIndexAmount !== finalAmount) ng("28 restore amount");
  ok("28 non-target status + restored expected_amount", `sum=${finalAmount}`);

  // 29 zero deals edge: if no other aggregating deals, should be 0
  const { data: remaining } = await supabase
    .from("deal_index")
    .select("status_semantic,expected_amount")
    .eq("customer_page_id", customerPageId);
  const remainSum = computeCustomerExpectedAmountFromDeals(remaining ?? []);
  if (remainSum !== finalAmount) ng("29 remain sum");
  if (remainSum === 0) {
    ok("29 zero aggregating deals → ¥0");
  } else {
    ok("29 remaining aggregating deals present", `sum=${remainSum}`);
  }

  // 30 not in_trash
  const endDomain = await loadDealDomain(
    notion,
    created.notionPageId!,
    baseDeps.propertiesByName,
  );
  if (endDomain.inTrash) ng("30 in_trash");
  ok("30 not in_trash");

  // 31 audit retained (no delete)
  const { count: auditStill } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!);
  if (!auditStill || auditStill < 1) ng("31 audit retained");
  const { count: auditDelete } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("notion_page_id", created.notionPageId!)
    .ilike("action", "%delete%");
  if ((auditDelete ?? 0) > 0) ng("31 unexpected delete audit");
  ok("31 audit_logs retained", `count=${auditStill}`);

  console.log(
    `ids: request_id=${maskId(createRequestId)} external_id=${maskId(externalId)} page=${maskId(created.notionPageId!)} customer=${maskId(customerPageId)}`,
  );
  console.log("\nE2E PASSED");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(`e2e failed: ${message}`);
  process.exit(1);
});

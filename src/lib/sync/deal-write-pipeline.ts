import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/deal";
import {
  executeDealCreate,
  executeDealUpdate,
  type DealWriteDeps,
  type DealWriteOpStore,
  type DealIndexStore,
  type DealAuditStore,
  type DealSyncErrorStore,
  type DealExpectedAmountRecalc,
} from "@/lib/sync/deal-write-pipeline-core";
import type {
  DealCreateCommand,
  DealUpdateCommand,
  DealWriteResult,
  WriteOperationRow,
  DealRecoveryPayload,
} from "@/lib/deals/types";
import { dealDomainToIndexRow } from "@/lib/deals/index-mapper";
import { requestCustomerExpectedAmountRecalc } from "@/lib/deals/request-recalc";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeDealCreate,
  executeDealUpdate,
} from "@/lib/sync/deal-write-pipeline-core";
export type { DealWriteDeps } from "@/lib/sync/deal-write-pipeline-core";
export {
  DealSyncError,
  isDealSyncError,
} from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): DealWriteOpStore {
  return {
    async getByRequestId(requestId) {
      const { data, error } = await admin
        .from("write_operations")
        .select("*")
        .eq("request_id", requestId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return data as unknown as WriteOperationRow;
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

function createIndexStore(admin: AdminClient): DealIndexStore {
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
        (data ?? []).map((u) => [u.notion_staff_page_id as string, u.id]),
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
        (data ?? []).map((c) => [c.notion_page_id as string, c.name as string]),
      );
      return contactPageIds.map((id) => map.get(id) ?? "").filter(Boolean);
    },
    async getStaffNames(staffPageIds) {
      if (staffPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("app_users")
        .select("notion_staff_page_id,display_name")
        .in("notion_staff_page_id", staffPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((u) => [
          u.notion_staff_page_id as string,
          u.display_name as string,
        ]),
      );
      return staffPageIds.map((id) => map.get(id) ?? "").filter(Boolean);
    },
  };
}

function createAuditStore(admin: AdminClient): DealAuditStore {
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

function createSyncErrorStore(admin: AdminClient): DealSyncErrorStore {
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

function createExpectedAmountRecalc(): DealExpectedAmountRecalc {
  return {
    async requestForCustomers(input) {
      await requestCustomerExpectedAmountRecalc({
        customerPageIds: input.customerPageIds,
        sourceDealExternalId: input.sourceDealExternalId,
        processInline: true,
      });
    },
  };
}

export async function loadDealPropertyMap(
  admin: AdminClient = createAdminClient(),
): Promise<PropertyIdMap> {
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SCHEMA_SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value as {
    databases?: {
      deals?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.deals?.properties;
  if (!props) {
    throw new Error("notion_schema_snapshot に deals プロパティがありません");
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

export async function createDealWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  dealsDataSourceId?: string;
}): Promise<DealWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds = input?.dealsDataSourceId ?? process.env.NOTION_DS_DEALS ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_DEALS が設定されていません");
  }
  const propertiesByName = await loadDealPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    dealsDataSourceId: ds,
    propertiesByName,
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    expectedAmountRecalc: createExpectedAmountRecalc(),
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

/** Server Action等から呼ぶ案件作成 */
export async function dealCreate(
  command: DealCreateCommand,
): Promise<DealWriteResult> {
  const deps = await createDealWriteDeps();
  return executeDealCreate(deps, command);
}

/** Server Action等から呼ぶ案件更新 */
export async function dealUpdate(
  command: DealUpdateCommand,
): Promise<DealWriteResult> {
  const deps = await createDealWriteDeps();
  return executeDealUpdate(deps, command);
}

export type { DealRecoveryPayload };
export type IndexRow = ReturnType<typeof dealDomainToIndexRow>;

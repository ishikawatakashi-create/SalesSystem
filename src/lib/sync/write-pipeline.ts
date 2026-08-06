import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";
import {
  executeCustomerCreate,
  executeCustomerUpdate,
  type CustomerWriteDeps,
  type WriteOpStore,
  type CustomerIndexStore,
  type AuditStore,
  type SyncErrorStore,
} from "@/lib/sync/write-pipeline-core";
import type {
  CustomerCreateCommand,
  CustomerUpdateCommand,
  CustomerWriteResult,
  WriteOperationRow,
  CustomerRecoveryPayload,
} from "@/lib/customers/types";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeCustomerCreate,
  executeCustomerUpdate,
} from "@/lib/sync/write-pipeline-core";
export type { CustomerWriteDeps } from "@/lib/sync/write-pipeline-core";
export { CustomerSyncError, isCustomerSyncError } from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): WriteOpStore {
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

function createIndexStore(admin: AdminClient): CustomerIndexStore {
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
        (data ?? []).map((u) => [u.notion_staff_page_id as string, u.id]),
      );
      return staffPageIds
        .map((pageId) => map.get(pageId))
        .filter((id): id is string => Boolean(id));
    },
  };
}

function createAuditStore(admin: AdminClient): AuditStore {
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

function createSyncErrorStore(admin: AdminClient): SyncErrorStore {
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

export async function loadCustomerPropertyMap(
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

export async function createCustomerWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  customersDataSourceId?: string;
}): Promise<CustomerWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds =
    input?.customersDataSourceId ?? process.env.NOTION_DS_CUSTOMERS ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_CUSTOMERS が設定されていません");
  }
  const propertiesByName = await loadCustomerPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    customersDataSourceId: ds,
    propertiesByName,
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

/** Server Action等から呼ぶ顧客作成 */
export async function customerCreate(
  command: CustomerCreateCommand,
): Promise<CustomerWriteResult> {
  const deps = await createCustomerWriteDeps();
  return executeCustomerCreate(deps, command);
}

/** Server Action等から呼ぶ顧客更新(アーカイブ含む) */
export async function customerUpdate(
  command: CustomerUpdateCommand,
): Promise<CustomerWriteResult> {
  const deps = await createCustomerWriteDeps();
  return executeCustomerUpdate(deps, command);
}

export type { CustomerRecoveryPayload };
export type IndexRow = ReturnType<typeof customerDomainToIndexRow>;

import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/contract";
import {
  executeContractCreate,
  executeContractUpdate,
  type ContractWriteDeps,
  type ContractWriteOpStore,
  type ContractIndexStore,
  type ContractAuditStore,
  type ContractSyncErrorStore,
} from "@/lib/sync/contract-write-pipeline-core";
import type {
  ContractCreateCommand,
  ContractUpdateCommand,
  ContractWriteResult,
  WriteOperationRow,
  ContractRecoveryPayload,
} from "@/lib/contracts/types";
import { contractDomainToIndexRow } from "@/lib/contracts/index-mapper";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeContractCreate,
  executeContractUpdate,
} from "@/lib/sync/contract-write-pipeline-core";
export type { ContractWriteDeps } from "@/lib/sync/contract-write-pipeline-core";
export {
  ContractSyncError,
  isContractSyncError,
} from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): ContractWriteOpStore {
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

function createIndexStore(admin: AdminClient): ContractIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin
        .from("contract_index")
        .upsert(row as never);
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
        (data ?? []).map((u) => [
          u.notion_staff_page_id as string,
          u.display_name as string,
        ]),
      );
      return staffPageIds.map((id) => map.get(id) ?? "").filter(Boolean);
    },
  };
}

function createAuditStore(admin: AdminClient): ContractAuditStore {
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

function createSyncErrorStore(admin: AdminClient): ContractSyncErrorStore {
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

export async function loadContractPropertyMap(
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
      contracts?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.contracts?.properties;
  if (!props) {
    throw new Error(
      "notion_schema_snapshot に contracts プロパティがありません",
    );
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

export async function createContractWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  contractsDataSourceId?: string;
}): Promise<ContractWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds =
    input?.contractsDataSourceId ?? process.env.NOTION_DS_CONTRACTS ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_CONTRACTS が設定されていません");
  }
  const propertiesByName = await loadContractPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    contractsDataSourceId: ds,
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

export async function contractCreate(
  command: ContractCreateCommand,
): Promise<ContractWriteResult> {
  const deps = await createContractWriteDeps();
  return executeContractCreate(deps, command);
}

export async function contractUpdate(
  command: ContractUpdateCommand,
): Promise<ContractWriteResult> {
  const deps = await createContractWriteDeps();
  return executeContractUpdate(deps, command);
}

export type { ContractRecoveryPayload };
export type IndexRow = ReturnType<typeof contractDomainToIndexRow>;

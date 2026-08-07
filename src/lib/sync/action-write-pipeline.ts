import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/action";
import {
  executeActionCreate,
  executeActionUpdate,
  type ActionWriteDeps,
  type ActionWriteOpStore,
  type ActionIndexStore,
  type ActionAuditStore,
  type ActionSyncErrorStore,
  type ActionNextRecalc,
} from "@/lib/sync/action-write-pipeline-core";
import type {
  ActionCreateCommand,
  ActionUpdateCommand,
  ActionWriteResult,
  WriteOperationRow,
  ActionRecoveryPayload,
} from "@/lib/actions/types";
import { actionDomainToIndexRow } from "@/lib/actions/index-mapper";
import { requestNextActionRecalc } from "@/lib/actions/request-rollup";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeActionCreate,
  executeActionUpdate,
} from "@/lib/sync/action-write-pipeline-core";
export type { ActionWriteDeps } from "@/lib/sync/action-write-pipeline-core";
export { ActionSyncError, isActionSyncError } from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): ActionWriteOpStore {
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
  };
}

function createIndexStore(admin: AdminClient): ActionIndexStore {
  return {
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

function createAuditStore(admin: AdminClient): ActionAuditStore {
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

function createSyncErrorStore(admin: AdminClient): ActionSyncErrorStore {
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

function createNextRecalc(): ActionNextRecalc {
  return {
    async requestForTargets(input) {
      await requestNextActionRecalc({
        customerPageIds: input.customerPageIds,
        dealPageIds: input.dealPageIds,
        sourceActionExternalId: input.sourceActionExternalId,
        processInline: true,
      });
    },
  };
}

export async function loadActionPropertyMap(
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
      actions?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.actions?.properties;
  if (!props) {
    throw new Error("notion_schema_snapshot に actions プロパティがありません");
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

export async function createActionWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  actionsDataSourceId?: string;
}): Promise<ActionWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds = input?.actionsDataSourceId ?? process.env.NOTION_DS_ACTIONS ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_ACTIONS が設定されていません");
  }
  const propertiesByName = await loadActionPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    actionsDataSourceId: ds,
    propertiesByName,
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    nextActionRecalc: createNextRecalc(),
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

export async function actionCreate(
  command: ActionCreateCommand,
): Promise<ActionWriteResult> {
  const deps = await createActionWriteDeps();
  return executeActionCreate(deps, command);
}

export async function actionUpdate(
  command: ActionUpdateCommand,
): Promise<ActionWriteResult> {
  const deps = await createActionWriteDeps();
  return executeActionUpdate(deps, command);
}

export type { ActionRecoveryPayload };
export type IndexRow = ReturnType<typeof actionDomainToIndexRow>;

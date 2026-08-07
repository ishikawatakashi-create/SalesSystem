import "server-only";

import type { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultNotionClient } from "@/lib/notion/client";
import { SCHEMA_SNAPSHOT_KEY } from "@/lib/notion/setup/apply";
import type { PropertyIdMap } from "@/lib/notion/converters/activity";
import {
  executeActivityCreate,
  executeActivityUpdate,
  type ActivityWriteDeps,
  type ActivityWriteOpStore,
  type ActivityIndexStore,
  type ActivityAuditStore,
  type ActivitySyncErrorStore,
  type ActivityLatestRecalc,
} from "@/lib/sync/activity-write-pipeline-core";
import type {
  ActivityCreateCommand,
  ActivityUpdateCommand,
  ActivityWriteResult,
  WriteOperationRow,
  ActivityRecoveryPayload,
} from "@/lib/activities/types";
import { activityDomainToIndexRow } from "@/lib/activities/index-mapper";
import { requestCustomerLatestActivityRecalc } from "@/lib/activities/request-rollup";
import {
  logNotionError,
  logNotionInfo,
  logNotionWarn,
} from "@/lib/notion/logger";

export {
  executeActivityCreate,
  executeActivityUpdate,
} from "@/lib/sync/activity-write-pipeline-core";
export type { ActivityWriteDeps } from "@/lib/sync/activity-write-pipeline-core";
export {
  ActivitySyncError,
  isActivitySyncError,
} from "@/lib/sync/errors";

type AdminClient = ReturnType<typeof createAdminClient>;

function createWriteOpStore(admin: AdminClient): ActivityWriteOpStore {
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
  };
}

function createIndexStore(admin: AdminClient): ActivityIndexStore {
  return {
    async upsert(row) {
      const { error } = await admin.from("activity_index").upsert(row as never);
      if (error) throw new Error(error.message);
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
    async getDealTitle(dealPageId) {
      const { data, error } = await admin
        .from("deal_index")
        .select("title")
        .eq("notion_page_id", dealPageId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.title as string | undefined) ?? null;
    },
    async getCategoryNames(categoryPageIds) {
      if (categoryPageIds.length === 0) return [];
      const { data, error } = await admin
        .from("masters_cache")
        .select("notion_page_id,name")
        .in("notion_page_id", categoryPageIds);
      if (error) throw new Error(error.message);
      const map = new Map(
        (data ?? []).map((m) => [m.notion_page_id as string, m.name as string]),
      );
      return categoryPageIds.map((id) => map.get(id) ?? "").filter(Boolean);
    },
  };
}

function createAuditStore(admin: AdminClient): ActivityAuditStore {
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
        batch_id: input.batchId ?? null,
      } as never);
      if (error) throw new Error(error.message);
    },
  };
}

function createSyncErrorStore(admin: AdminClient): ActivitySyncErrorStore {
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

function createLatestRecalc(): ActivityLatestRecalc {
  return {
    async requestForCustomers(input) {
      await requestCustomerLatestActivityRecalc({
        customerPageIds: input.customerPageIds,
        sourceActivityExternalId: input.sourceActivityExternalId,
        processInline: true,
      });
    },
  };
}

export async function loadActivityPropertyMap(
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
      activities?: {
        properties?: Record<string, { id: string; name: string; type: string }>;
      };
    };
  } | null;
  const props = value?.databases?.activities?.properties;
  if (!props) {
    throw new Error(
      "notion_schema_snapshot に activities プロパティがありません",
    );
  }
  const map: PropertyIdMap = {};
  for (const [name, meta] of Object.entries(props)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

export async function createActivityWriteDeps(input?: {
  notion?: Client;
  admin?: AdminClient;
  activitiesDataSourceId?: string;
}): Promise<ActivityWriteDeps> {
  const admin = input?.admin ?? createAdminClient();
  const ds =
    input?.activitiesDataSourceId ?? process.env.NOTION_DS_ACTIVITIES ?? "";
  if (!ds) {
    throw new Error("NOTION_DS_ACTIVITIES が設定されていません");
  }
  const propertiesByName = await loadActivityPropertyMap(admin);
  return {
    notion: input?.notion ?? createDefaultNotionClient(),
    activitiesDataSourceId: ds,
    propertiesByName,
    writeOps: createWriteOpStore(admin),
    index: createIndexStore(admin),
    audit: createAuditStore(admin),
    syncErrors: createSyncErrorStore(admin),
    latestActivityRecalc: createLatestRecalc(),
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

export async function activityCreate(
  command: ActivityCreateCommand,
): Promise<ActivityWriteResult> {
  const deps = await createActivityWriteDeps();
  return executeActivityCreate(deps, command);
}

export async function activityUpdate(
  command: ActivityUpdateCommand,
): Promise<ActivityWriteResult> {
  const deps = await createActivityWriteDeps();
  return executeActivityUpdate(deps, command);
}

export type { ActivityRecoveryPayload };
export type IndexRow = ReturnType<typeof activityDomainToIndexRow>;

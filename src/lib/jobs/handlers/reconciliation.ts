import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import { enqueueJob } from "@/lib/jobs/queue";
import { createDefaultNotionClient } from "@/lib/notion/client";
import {
  INDEX_TABLE_BY_ENTITY,
  loadDataSourceEnvMap,
  type SyncEntityKey,
} from "@/lib/sync/ds-routing";
import {
  isRetryableNotionError,
  syncPageFromNotion,
} from "@/lib/sync/inbound-page-sync";
import {
  detectSchemaDrift,
  recordSchemaDriftFindings,
} from "@/lib/sync/schema-drift";
import { createAdminClient } from "@/lib/supabase/admin";

/** Vercel maxDuration 内に収めるため、1実行あたり1 DS × 少数ページ */
const SAMPLE_PAGE_SIZE = 5;

type QueryPage = {
  id: string;
  in_trash?: boolean;
  last_edited_time?: string;
};

type ReconCursor = {
  entityIndex: number;
  driftDone?: boolean;
  checked?: number;
  repaired?: number;
  deletePending?: number;
  driftCount?: number;
};

function indexTableFor(entity: SyncEntityKey): string {
  if (entity === "masters") return "masters_cache";
  return INDEX_TABLE_BY_ENTITY[entity];
}

/**
 * 日次整合性確認(チャンク実行)。
 * - 初回: スキーマドリフト検知
 * - 以降: DSごとに最近編集ページを少量同期し、cursor で継続
 */
export const reconciliationHandler: JobHandler = async (job, ctx) => {
  const admin = createAdminClient();
  const notion = createDefaultNotionClient();
  const envMap = loadDataSourceEnvMap();
  const entities = (Object.keys(envMap) as SyncEntityKey[]).filter(
    (k) => Boolean(envMap[k]),
  );

  const cursor = (job.cursor ?? {}) as ReconCursor;
  let entityIndex = cursor.entityIndex ?? 0;
  let checked = cursor.checked ?? 0;
  let repaired = cursor.repaired ?? 0;
  let deletePending = cursor.deletePending ?? 0;
  let driftCount = cursor.driftCount ?? 0;
  let driftDone = cursor.driftDone ?? false;

  try {
    if (!driftDone) {
      const alive = await ctx.heartbeat();
      if (!alive) {
        return {
          status: "retry",
          errorMessage: "lease_lost_before_drift",
          backoffSeconds: 30,
        };
      }
      const findings = await detectSchemaDrift({ notion, admin, entities });
      driftCount = await recordSchemaDriftFindings({
        findings,
        admin,
        source: "reconciliation",
      });
      driftDone = true;

      // 次チャンクへ
      await admin
        .from("jobs")
        .update({
          cursor: {
            entityIndex: 0,
            driftDone: true,
            checked,
            repaired,
            deletePending,
            driftCount,
          },
          progress_done: 1,
          progress_total: entities.length + 1,
        } as never)
        .eq("id", job.id);

      return {
        status: "retry",
        errorMessage: "reconciliation_continue_after_drift",
        backoffSeconds: 1,
      };
    }

    if (entityIndex >= entities.length) {
      await admin.from("audit_logs").insert({
        actor_id: null,
        actor_name: null,
        action: "sync.reconciliation",
        entity_type: null,
        notion_page_id: null,
        changed_fields: {
          checked,
          repaired,
          deletePending,
          driftCount,
          jobId: job.id,
        },
        operation_source: "reconciliation",
        request_id: null,
      } as never);

      return {
        status: "succeeded",
        result: { checked, repaired, deletePending, driftCount },
      };
    }

    const entity = entities[entityIndex]!;
    const dataSourceId = envMap[entity]!;
    const indexTable = indexTableFor(entity);

    const alive = await ctx.heartbeat();
    if (!alive) {
      return {
        status: "retry",
        errorMessage: "lease_lost",
        backoffSeconds: 30,
      };
    }

    const res = (await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: SAMPLE_PAGE_SIZE,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    } as never)) as { results: QueryPage[] };

    for (const page of res.results ?? []) {
      checked += 1;
      if (page.in_trash) {
        const { data: row } = await admin
          .from(indexTable as "customer_index")
          .select("sync_status")
          .eq("notion_page_id", page.id)
          .maybeSingle();
        if (
          row &&
          row.sync_status !== "delete_pending" &&
          row.sync_status !== "excluded"
        ) {
          await admin
            .from(indexTable as "customer_index")
            .update({
              sync_status: "delete_pending",
              sync_error_message: "reconciliation: in_trash",
            } as never)
            .eq("notion_page_id", page.id);
          deletePending += 1;
        }
        continue;
      }

      const result = await syncPageFromNotion({
        pageId: page.id,
        notion,
        admin,
        hintedDataSourceId: dataSourceId,
        eventType: "reconciliation",
      });
      if (result.status === "synced" && !result.skipped) {
        repaired += 1;
      }
    }

    entityIndex += 1;
    await admin
      .from("jobs")
      .update({
        cursor: {
          entityIndex,
          driftDone: true,
          checked,
          repaired,
          deletePending,
          driftCount,
        },
        progress_done: entityIndex + 1,
        progress_total: entities.length + 1,
      } as never)
      .eq("id", job.id);

    if (entityIndex >= entities.length) {
      await admin.from("audit_logs").insert({
        actor_id: null,
        actor_name: null,
        action: "sync.reconciliation",
        entity_type: null,
        notion_page_id: null,
        changed_fields: {
          checked,
          repaired,
          deletePending,
          driftCount,
          jobId: job.id,
        },
        operation_source: "reconciliation",
        request_id: null,
      } as never);
      return {
        status: "succeeded",
        result: { checked, repaired, deletePending, driftCount },
      };
    }

    return {
      status: "retry",
      errorMessage: "reconciliation_continue",
      backoffSeconds: 1,
    };
  } catch (error) {
    if (isRetryableNotionError(error)) {
      return {
        status: "retry",
        errorMessage:
          error instanceof Error ? error.message : "reconciliation_retry",
        backoffSeconds: 120,
      };
    }
    return {
      status: "failed",
      errorMessage:
        error instanceof Error ? error.message : "reconciliation_failed",
    };
  }
};

/** 手動再実行用: pageId 指定で sync_repair を enqueue */
export async function enqueueSyncRepair(input: {
  pageId: string;
  createdBy?: string | null;
}): Promise<string> {
  const job = await enqueueJob({
    kind: "sync_repair",
    payload: { pageId: input.pageId },
    idempotencyKey: `sync_repair:${input.pageId}:${Date.now()}`,
    createdBy: input.createdBy ?? null,
    priority: 40,
  });
  return job.id;
}

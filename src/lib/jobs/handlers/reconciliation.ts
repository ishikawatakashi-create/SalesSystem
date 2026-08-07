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

/** 1実行あたり 1 DS × 少数ページ(Vercel 60s 内) */
const SAMPLE_PAGE_SIZE = 3;

type QueryPage = {
  id: string;
  in_trash?: boolean;
  last_edited_time?: string;
};

type ReconCursor = {
  /** drift 用の entity index。entities.length で完了 */
  driftIndex?: number;
  /** page sync 用の entity index */
  entityIndex?: number;
  phase?: "drift" | "pages" | "done";
  checked?: number;
  repaired?: number;
  deletePending?: number;
  driftCount?: number;
};

function indexTableFor(entity: SyncEntityKey): string {
  if (entity === "masters") return "masters_cache";
  return INDEX_TABLE_BY_ENTITY[entity];
}

async function persistCursor(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  cursor: ReconCursor,
  progressDone: number,
  progressTotal: number,
): Promise<void> {
  await admin
    .from("jobs")
    .update({
      cursor,
      progress_done: progressDone,
      progress_total: progressTotal,
    } as never)
    .eq("id", jobId);
}

/**
 * 日次整合性確認(細粒度チャンク)。
 * 1実行 = ドリフト1DS または ページ同期1DS。
 */
export const reconciliationHandler: JobHandler = async (job, ctx) => {
  const admin = createAdminClient();
  const notion = createDefaultNotionClient();
  const envMap = loadDataSourceEnvMap();
  const entities = (Object.keys(envMap) as SyncEntityKey[]).filter((k) =>
    Boolean(envMap[k]),
  );
  const totalSteps = entities.length * 2 + 1;

  const cursor = (job.cursor ?? {}) as ReconCursor;
  let phase = cursor.phase ?? "drift";
  let driftIndex = cursor.driftIndex ?? 0;
  let entityIndex = cursor.entityIndex ?? 0;
  let checked = cursor.checked ?? 0;
  let repaired = cursor.repaired ?? 0;
  let deletePending = cursor.deletePending ?? 0;
  let driftCount = cursor.driftCount ?? 0;

  try {
    const alive = await ctx.heartbeat();
    if (!alive) {
      return {
        status: "retry",
        errorMessage: "lease_lost",
        backoffSeconds: 30,
      };
    }

    if (phase === "drift") {
      if (driftIndex >= entities.length) {
        phase = "pages";
        entityIndex = 0;
      } else {
        const entity = entities[driftIndex]!;
        const findings = await detectSchemaDrift({
          notion,
          admin,
          entities: [entity],
        });
        driftCount += await recordSchemaDriftFindings({
          findings,
          admin,
          source: "reconciliation",
        });
        driftIndex += 1;
        await persistCursor(
          admin,
          job.id,
          {
            phase: "drift",
            driftIndex,
            entityIndex: 0,
            checked,
            repaired,
            deletePending,
            driftCount,
          },
          driftIndex,
          totalSteps,
        );
        return {
          status: "retry",
          errorMessage: "reconciliation_continue_drift",
          backoffSeconds: 1,
        };
      }
    }

    if (phase === "pages") {
      if (entityIndex >= entities.length) {
        phase = "done";
      } else {
        const entity = entities[entityIndex]!;
        const dataSourceId = envMap[entity]!;
        const indexTable = indexTableFor(entity);

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
        await persistCursor(
          admin,
          job.id,
          {
            phase: "pages",
            driftIndex: entities.length,
            entityIndex,
            checked,
            repaired,
            deletePending,
            driftCount,
          },
          entities.length + entityIndex,
          totalSteps,
        );

        if (entityIndex < entities.length) {
          return {
            status: "retry",
            errorMessage: "reconciliation_continue_pages",
            backoffSeconds: 1,
          };
        }
        phase = "done";
      }
    }

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

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

const SAMPLE_PAGE_SIZE = 20;

type QueryPage = {
  id: string;
  in_trash?: boolean;
  last_edited_time?: string;
};

function indexTableFor(entity: SyncEntityKey): string {
  if (entity === "masters") return "masters_cache";
  return INDEX_TABLE_BY_ENTITY[entity];
}

/**
 * 日次整合性確認の最小実装。
 * - 各 NOTION_DS_* から最近編集ページをサンプル取得し hash / trash を照合
 * - スキーマドリフト検知
 */
export const reconciliationHandler: JobHandler = async (job) => {
  const admin = createAdminClient();
  const notion = createDefaultNotionClient();
  const envMap = loadDataSourceEnvMap();
  const entities = Object.keys(envMap) as SyncEntityKey[];

  let checked = 0;
  let repaired = 0;
  let deletePending = 0;
  let driftCount = 0;

  try {
    const findings = await detectSchemaDrift({ notion, admin, entities });
    driftCount = await recordSchemaDriftFindings({
      findings,
      admin,
      source: "reconciliation",
    });

    for (const entity of entities) {
      const dataSourceId = envMap[entity];
      if (!dataSourceId) continue;
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

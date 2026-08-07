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

const SAMPLE_PAGE_SIZE = 3;

type QueryPage = {
  id: string;
  in_trash?: boolean;
};

type ReconPayload = {
  phase?: "drift" | "pages";
  index?: number;
  checked?: number;
  repaired?: number;
  deletePending?: number;
  driftCount?: number;
  source?: string;
  chainId?: string;
};

function indexTableFor(entity: SyncEntityKey): string {
  if (entity === "masters") return "masters_cache";
  return INDEX_TABLE_BY_ENTITY[entity];
}

async function enqueueContinuation(input: {
  payload: ReconPayload;
  createdBy: string | null;
}): Promise<void> {
  const chainId = input.payload.chainId ?? crypto.randomUUID();
  const phase = input.payload.phase ?? "drift";
  const index = input.payload.index ?? 0;
  await enqueueJob({
    kind: "reconciliation",
    payload: { ...input.payload, chainId },
    idempotencyKey: `reconciliation:${chainId}:${phase}:${index}`,
    createdBy: input.createdBy,
    priority: 40,
  });
}

/**
 * 日次整合性確認。
 * 1ジョブ = 1チャンク。続きは新規ジョブを enqueue して succeeded を返す
 * (fail_job の attempts を消費しない)。
 */
export const reconciliationHandler: JobHandler = async (job, ctx) => {
  const admin = createAdminClient();
  const notion = createDefaultNotionClient();
  const envMap = loadDataSourceEnvMap();
  const entities = (Object.keys(envMap) as SyncEntityKey[]).filter((k) =>
    Boolean(envMap[k]),
  );

  const payload = (job.payload ?? {}) as ReconPayload;
  const phase = payload.phase ?? "drift";
  const index = payload.index ?? 0;
  let checked = payload.checked ?? 0;
  let repaired = payload.repaired ?? 0;
  let deletePending = payload.deletePending ?? 0;
  let driftCount = payload.driftCount ?? 0;
  const chainId = payload.chainId ?? job.id;
  const createdBy = job.created_by;

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
      if (index < entities.length) {
        const entity = entities[index]!;
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

        await enqueueContinuation({
          createdBy,
          payload: {
            source: payload.source,
            chainId,
            phase: "drift",
            index: index + 1,
            checked,
            repaired,
            deletePending,
            driftCount,
          },
        });
        return {
          status: "succeeded",
          result: { chunk: "drift", entity, driftCount },
        };
      }

      // drift 完了 → pages へ
      await enqueueContinuation({
        createdBy,
        payload: {
          source: payload.source,
          chainId,
          phase: "pages",
          index: 0,
          checked,
          repaired,
          deletePending,
          driftCount,
        },
      });
      return {
        status: "succeeded",
        result: { chunk: "drift_done", driftCount },
      };
    }

    // pages phase
    if (index < entities.length) {
      const entity = entities[index]!;
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

      await enqueueContinuation({
        createdBy,
        payload: {
          source: payload.source,
          chainId,
          phase: "pages",
          index: index + 1,
          checked,
          repaired,
          deletePending,
          driftCount,
        },
      });
      return {
        status: "succeeded",
        result: { chunk: "pages", entity, checked, repaired },
      };
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
        chainId,
        finalJobId: job.id,
      },
      operation_source: "reconciliation",
      request_id: null,
    } as never);

    return {
      status: "succeeded",
      result: {
        chunk: "final",
        checked,
        repaired,
        deletePending,
        driftCount,
        chainId,
      },
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

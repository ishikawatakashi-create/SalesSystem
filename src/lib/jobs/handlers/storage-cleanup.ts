import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteExpiredImportObject } from "@/lib/csv/storage";
import { recordStorageCleanupResult } from "@/lib/jobs/daily-maintenance";
import { uuidV5 } from "@/lib/notion/ids";

const BATCH_SIZE = 100;

/**
 * 期限切れ import CSV 原本の Storage 削除。
 * - imports bucket / import_jobs.expires_at 超過かつ deleted_at null のみ
 * - CSV本文・個人情報はログに出さない
 * - バッチ超過時は継続ジョブを enqueue（冪等）
 */
export const storageCleanupHandler: JobHandler = async (job, ctx) => {
  const admin = createAdminClient();
  const payload = (job.payload ?? {}) as {
    chainId?: string;
    cleaned?: number;
    failed?: number;
  };
  const chainId = payload.chainId ?? job.id;
  let cleaned = payload.cleaned ?? 0;
  let failed = payload.failed ?? 0;

  try {
    const alive = await ctx.heartbeat();
    if (!alive) {
      return {
        status: "retry",
        errorMessage: "lease_lost",
        backoffSeconds: 30,
      };
    }

    const { data: expiredJobs, error: selectError } = await admin
      .from("import_jobs")
      .select("id, storage_path")
      .lt("expires_at", new Date().toISOString())
      .is("deleted_at", null)
      .order("expires_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (selectError) {
      return {
        status: "failed",
        errorMessage: "storage_cleanup_select_failed",
      };
    }

    if (!expiredJobs || expiredJobs.length === 0) {
      await recordStorageCleanupResult({ cleaned, failed });
      await admin.from("audit_logs").insert({
        actor_id: null,
        actor_name: "system",
        action: "storage.cleanup",
        entity_type: "import_job",
        notion_page_id: null,
        changed_fields: { cleaned, failed, chainId },
        operation_source: "storage_cleanup",
        request_id: uuidV5(`storage_cleanup:${chainId}:done`),
      } as never);
      return {
        status: "succeeded",
        result: { cleaned, failed, final: true },
      };
    }

    for (const row of expiredJobs) {
      const stillAlive = await ctx.heartbeat();
      if (!stillAlive) {
        return {
          status: "retry",
          errorMessage: "lease_lost_during_batch",
          backoffSeconds: 30,
        };
      }

      const path = String(row.storage_path ?? "");
      if (!path) {
        await admin
          .from("import_jobs")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id);
        cleaned += 1;
        continue;
      }

      try {
        await deleteExpiredImportObject(path);
        await admin
          .from("import_jobs")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id);
        cleaned += 1;
      } catch (error) {
        await admin.from("sync_errors").insert({
          stage: "storage_cleanup_failed",
          entity_type: "import_job",
          external_id: row.id,
          message:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "storage_cleanup_failed",
          detail: {
            pathPrefix: path.split("/").slice(0, 2).join("/"),
            errorName: error instanceof Error ? error.name : "unknown",
          },
        });
        failed += 1;
      }
    }

    if (expiredJobs.length >= BATCH_SIZE) {
      await enqueueJob({
        kind: "storage_cleanup",
        payload: { chainId, cleaned, failed },
        idempotencyKey: `storage_cleanup:${chainId}:cont:${cleaned}`,
        priority: 80,
      });
      return {
        status: "succeeded",
        result: { cleaned, failed, continued: true },
      };
    }

    await recordStorageCleanupResult({ cleaned, failed });
    await admin.from("audit_logs").insert({
      actor_id: null,
      actor_name: "system",
      action: "storage.cleanup",
      entity_type: "import_job",
      notion_page_id: null,
      changed_fields: { cleaned, failed, chainId },
      operation_source: "storage_cleanup",
      request_id: uuidV5(`storage_cleanup:${chainId}:done`),
    } as never);

    return {
      status: "succeeded",
      result: { cleaned, failed, final: true },
    };
  } catch {
    return {
      status: "failed",
      errorMessage: "storage_cleanup_failed",
    };
  }
};

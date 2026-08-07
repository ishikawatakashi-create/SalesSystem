import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteExpiredImportObject } from "@/lib/csv/storage";

/**
 * ストレージクリーンアップジョブハンドラー
 * 
 * 期限切れのimport_jobsストレージオブジェクトを削除
 */
export const storageCleanupHandler: JobHandler = async (_job, ctx) => {
  const admin = createAdminClient();

  try {
    const alive = await ctx.heartbeat();
    if (!alive) {
      return {
        status: "retry",
        errorMessage: "lease_lost",
        backoffSeconds: 30,
      };
    }

    // Select expired import_jobs that haven't been deleted yet
    const { data: expiredJobs, error: selectError } = await admin
      .from("import_jobs")
      .select("id, storage_path")
      .lt("expires_at", new Date().toISOString())
      .is("deleted_at", null)
      .limit(100); // Process in batches

    if (selectError) {
      return {
        status: "failed",
        errorMessage: `Failed to select expired jobs: ${selectError.message}`,
      };
    }

    if (!expiredJobs || expiredJobs.length === 0) {
      return {
        status: "succeeded",
        result: { cleaned: 0, message: "No expired jobs found" },
      };
    }

    let cleaned = 0;
    let failed = 0;

    for (const job of expiredJobs) {
      try {
        // Delete storage object
        await deleteExpiredImportObject(job.storage_path);

        // Mark as deleted
        await admin
          .from("import_jobs")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", job.id);

        cleaned += 1;
      } catch (error) {
        // Log error to sync_errors WITHOUT file contents
        await admin.from("sync_errors").insert({
          stage: "storage_cleanup_failed",
          entity_type: "import_job",
          external_id: job.id,
          message:
            error instanceof Error
              ? error.message
              : "Failed to cleanup storage object",
          detail: {
            // Do NOT include file contents or PII
            storagePath: job.storage_path.split("/").slice(0, 2).join("/"), // Only include user/job path prefix
            error: error instanceof Error ? error.name : "unknown",
          },
        });
        failed += 1;
      }
    }

    return {
      status: "succeeded",
      result: { cleaned, failed, total: expiredJobs.length },
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage:
        error instanceof Error ? error.message : "storage_cleanup_failed",
    };
  }
};

import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import {
  isRetryableNotionError,
  syncPageFromNotion,
} from "@/lib/sync/inbound-page-sync";

/**
 * 同期エラー画面からの再実行用。pageId を再取得して index へ upsert。
 */
export const syncRepairHandler: JobHandler = async (job) => {
  const pageId = job.payload.pageId;
  if (typeof pageId !== "string" || !pageId) {
    return { status: "failed", errorMessage: "payload.pageId が必要です" };
  }

  try {
    const result = await syncPageFromNotion({
      pageId,
      eventType: "sync_repair",
    });
    return { status: "succeeded", result };
  } catch (error) {
    if (isRetryableNotionError(error)) {
      return {
        status: "retry",
        errorMessage: error instanceof Error ? error.message : "sync_repair_retry",
        backoffSeconds: 60,
      };
    }
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "sync_repair_failed",
    };
  }
};

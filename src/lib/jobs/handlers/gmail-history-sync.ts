import type { JobHandler } from "@/lib/jobs/types";
import { syncGmailHistory } from "@/lib/integrations/gmail/history-sync";

export const gmailHistorySyncHandler: JobHandler = async (job) => {
  const historyId =
    typeof job.payload.history_id === "string"
      ? job.payload.history_id
      : null;
  try {
    const result = await syncGmailHistory({ notifyHistoryId: historyId });
    return {
      status: "succeeded",
      result: {
        processed: result.processed,
        created: result.created,
        skipped: result.skipped,
        reconciled: result.reconciled ?? false,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "gmail_history_sync_failed";
    if (msg.startsWith("gmail_temporary_") || msg === "gmail_auth_failed") {
      return { status: "retry", errorMessage: msg, backoffSeconds: 60 };
    }
    if (msg === "gmail_reconnect_required") {
      return { status: "failed", errorMessage: msg };
    }
    return { status: "retry", errorMessage: msg.slice(0, 200), backoffSeconds: 120 };
  }
};

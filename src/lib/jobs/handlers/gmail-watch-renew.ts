import type { JobHandler } from "@/lib/jobs/types";
import { renewGmailWatch } from "@/lib/integrations/gmail/watch";

export const gmailWatchRenewHandler: JobHandler = async () => {
  const result = await renewGmailWatch();
  if (result.ok) {
    return {
      status: "succeeded",
      result: {
        historyId: result.historyId ?? null,
        expiration: result.expiration ?? null,
      },
    };
  }
  if (
    result.reason === "not_connected" ||
    result.reason === "label_not_selected" ||
    result.reason === "ingestion_disabled" ||
    result.reason === "env_missing"
  ) {
    return {
      status: "succeeded",
      result: { skipped: true, reason: result.reason },
    };
  }
  if (result.reason === "gmail_reconnect_required") {
    return { status: "failed", errorMessage: result.reason };
  }
  return {
    status: "retry",
    errorMessage: result.reason ?? "watch_renew_failed",
    backoffSeconds: 300,
  };
};

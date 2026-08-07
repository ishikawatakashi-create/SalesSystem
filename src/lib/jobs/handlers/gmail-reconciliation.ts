import type { JobHandler } from "@/lib/jobs/types";
import { reconcileGmailLabelMessages } from "@/lib/integrations/gmail/reconciliation";

export const gmailReconciliationHandler: JobHandler = async () => {
  try {
    const result = await reconcileGmailLabelMessages({ days: 7, maxMessages: 100 });
    return {
      status: "succeeded",
      result: { processed: result.processed, created: result.created },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "gmail_reconciliation_failed";
    if (msg === "gmail_reconnect_required") {
      return { status: "failed", errorMessage: msg };
    }
    return { status: "retry", errorMessage: msg.slice(0, 200), backoffSeconds: 300 };
  }
};

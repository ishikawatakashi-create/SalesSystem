import { recalculateCustomerExpectedAmount } from "@/lib/deals/recalculate-expected-amount";
import type { JobHandler } from "@/lib/jobs/types";

export const recalculateExpectedAmountHandler: JobHandler = async (job) => {
  const customerPageId = job.payload.customerPageId;
  if (typeof customerPageId !== "string" || !customerPageId) {
    return {
      status: "failed",
      errorMessage: "payload.customerPageId が必要です",
    };
  }

  const sourceDealExternalId =
    typeof job.payload.sourceDealExternalId === "string"
      ? job.payload.sourceDealExternalId
      : null;

  try {
    const result = await recalculateCustomerExpectedAmount({
      customerPageId,
      sourceDealExternalId,
      jobId: job.id,
    });
    return {
      status: "succeeded",
      result: {
        customerPageId: result.customerPageId,
        before: result.before,
        after: result.after,
        dealCount: result.dealCount,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "recalc_failed";
    return { status: "retry", errorMessage: message };
  }
};

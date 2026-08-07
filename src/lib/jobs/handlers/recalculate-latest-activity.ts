import { recalculateCustomerLatestActivity } from "@/lib/activities/recalculate-latest-activity";
import type { JobHandler } from "@/lib/jobs/types";

export const recalculateLatestActivityHandler: JobHandler = async (job) => {
  const customerPageId = job.payload.customerPageId;
  if (typeof customerPageId !== "string" || !customerPageId) {
    return {
      status: "failed",
      errorMessage: "payload.customerPageId が必要です",
    };
  }

  const sourceActivityExternalId =
    typeof job.payload.sourceActivityExternalId === "string"
      ? job.payload.sourceActivityExternalId
      : null;

  try {
    const result = await recalculateCustomerLatestActivity({
      customerPageId,
      sourceActivityExternalId,
      jobId: job.id,
    });
    return {
      status: "succeeded",
      result: {
        customerPageId: result.customerPageId,
        before: result.before,
        after: result.after,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "recalc_failed";
    return { status: "retry", errorMessage: message };
  }
};

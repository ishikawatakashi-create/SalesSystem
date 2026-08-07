import {
  recalculateCustomerNextAction,
  recalculateDealNextAction,
} from "@/lib/actions/recalculate-next-action";
import type { JobHandler } from "@/lib/jobs/types";

export const recalculateCustomerNextActionHandler: JobHandler = async (
  job,
) => {
  const customerPageId = job.payload.customerPageId;
  if (typeof customerPageId !== "string" || !customerPageId) {
    return {
      status: "failed",
      errorMessage: "payload.customerPageId が必要です",
    };
  }

  const sourceActionExternalId =
    typeof job.payload.sourceActionExternalId === "string"
      ? job.payload.sourceActionExternalId
      : null;

  try {
    const result = await recalculateCustomerNextAction({
      customerPageId,
      sourceActionExternalId,
      jobId: job.id,
    });
    return {
      status: "succeeded",
      result: {
        targetType: result.targetType,
        targetPageId: result.targetPageId,
        before: result.before,
        after: result.after,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "recalc_failed";
    return { status: "retry", errorMessage: message };
  }
};

export const recalculateDealNextActionHandler: JobHandler = async (job) => {
  const dealPageId = job.payload.dealPageId;
  if (typeof dealPageId !== "string" || !dealPageId) {
    return {
      status: "failed",
      errorMessage: "payload.dealPageId が必要です",
    };
  }

  const sourceActionExternalId =
    typeof job.payload.sourceActionExternalId === "string"
      ? job.payload.sourceActionExternalId
      : null;

  try {
    const result = await recalculateDealNextAction({
      dealPageId,
      sourceActionExternalId,
      jobId: job.id,
    });
    return {
      status: "succeeded",
      result: {
        targetType: result.targetType,
        targetPageId: result.targetPageId,
        before: result.before,
        after: result.after,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "recalc_failed";
    return { status: "retry", errorMessage: message };
  }
};

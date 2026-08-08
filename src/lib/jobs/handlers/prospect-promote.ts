import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import {
  promoteProspect,
  type PromoteProspectPayload,
} from "@/lib/prospects/promote";

export const prospectPromoteHandler: JobHandler = async (job, ctx) => {
  const alive = await ctx.heartbeat();
  if (!alive) {
    return {
      status: "retry",
      errorMessage: "lease_lost",
      backoffSeconds: 30,
    };
  }

  const payload = job.payload as unknown as PromoteProspectPayload;
  if (!payload?.prospectId || !payload?.requestId || !payload?.actorId) {
    return {
      status: "failed",
      errorMessage: "invalid_promote_payload",
    };
  }

  try {
    const result = await promoteProspect(payload);
    if (result.status !== "completed") {
      return {
        status: "retry",
        errorMessage: `promotion_incomplete:${result.status}:${result.error ?? ""}`,
        backoffSeconds: 60,
      };
    }
    return {
      status: "succeeded",
      result: {
        customerPageId: result.customerPageId,
        contactCount: result.contactPageIds.length,
        activityCount: result.activityPageIds.length,
        actionPageId: result.actionPageId,
        dealPageId: result.dealPageId,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "prospect_promote_failed";
    // resume-able / transient
    if (
      /rate|timeout|ECONNRESET|503|429|notion|incomplete/i.test(message)
    ) {
      return {
        status: "retry",
        errorMessage: message,
        backoffSeconds: 120,
      };
    }
    return { status: "failed", errorMessage: message };
  }
};

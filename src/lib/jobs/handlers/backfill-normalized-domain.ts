import "server-only";

import {
  processBackfillNormalizedDomainChunk,
  type BackfillNormalizedDomainPayload,
} from "@/lib/customers/backfill-normalized-domain";
import type { JobHandler } from "@/lib/jobs/types";

export const backfillNormalizedDomainHandler: JobHandler = async (job, ctx) => {
  const alive = await ctx.heartbeat();
  if (!alive) {
    return {
      status: "retry",
      errorMessage: "lease_lost",
      backoffSeconds: 30,
    };
  }

  const payload = (job.payload ?? {}) as BackfillNormalizedDomainPayload;
  try {
    const result = await processBackfillNormalizedDomainChunk({
      payload: {
        ...payload,
        chainId: payload.chainId ?? job.id,
      },
      enqueueNext: true,
      createdBy: job.created_by,
      heartbeat: ctx.heartbeat,
    });
    return {
      status: "succeeded",
      result: {
        done: result.done,
        chunkSize: result.chunkSize,
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        cursor: result.cursor,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "backfill_normalized_domain_failed";
    if (message === "lease_lost_during_chunk") {
      return {
        status: "retry",
        errorMessage: message,
        backoffSeconds: 30,
      };
    }
    return {
      status: "retry",
      errorMessage: message,
      backoffSeconds: 120,
    };
  }
};

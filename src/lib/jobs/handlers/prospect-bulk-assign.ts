import "server-only";

import { bulkAssignMemberships } from "@/lib/prospects/memberships";
import { enqueueJob } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/types";

const CHUNK = 80;

export const prospectBulkAssignHandler: JobHandler = async (job, ctx) => {
  const alive = await ctx.heartbeat();
  if (!alive) {
    return {
      status: "retry",
      errorMessage: "lease_lost",
      backoffSeconds: 30,
    };
  }

  const payload = (job.payload ?? {}) as {
    membershipIds?: string[];
    assigneeUserIds?: string[];
    mode?: "single" | "equal";
    onlyUnassigned?: boolean;
    overwrite?: boolean;
    actorId?: string;
    actorName?: string;
    offset?: number;
    updated?: number;
    skipped?: number;
    batchId?: string;
  };

  const ids = payload.membershipIds ?? [];
  const offset = payload.offset ?? 0;
  const slice = ids.slice(offset, offset + CHUNK);
  if (slice.length === 0) {
    return { status: "succeeded", result: { done: true } };
  }

  try {
    const result = await bulkAssignMemberships({
      membershipIds: slice,
      assigneeUserIds: payload.assigneeUserIds ?? [],
      mode: payload.mode ?? "single",
      onlyUnassigned: payload.onlyUnassigned,
      overwrite: payload.overwrite,
      actorId: payload.actorId ?? job.created_by ?? "system",
      actorName: payload.actorName ?? "system",
      batchId: payload.batchId ?? job.id,
    });

    const nextOffset = offset + slice.length;
    const updated = (payload.updated ?? 0) + result.updated;
    const skipped = (payload.skipped ?? 0) + result.skipped;
    const done = nextOffset >= ids.length;

    if (!done) {
      await enqueueJob({
        kind: "prospect_bulk_assign",
        payload: {
          ...payload,
          offset: nextOffset,
          updated,
          skipped,
          batchId: payload.batchId ?? job.id,
        },
        priority: 35,
        idempotencyKey: `prospect_bulk_assign:${payload.batchId ?? job.id}:${nextOffset}`,
        createdBy: payload.actorId ?? job.created_by,
      });
    }

    return {
      status: "succeeded",
      result: { done, updated, skipped, nextOffset },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "prospect_bulk_assign_failed";
    return { status: "retry", errorMessage: message, backoffSeconds: 60 };
  }
};

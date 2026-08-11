import "server-only";

import {
  failProspectImportJobIfCurrent,
  isTerminalProspectImportErrorMessage,
  PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE,
  processProspectImportChunk,
} from "@/lib/prospects/import";
import type { JobHandler } from "@/lib/jobs/types";

export const prospectCsvImportHandler: JobHandler = async (job, ctx) => {
  const alive = await ctx.heartbeat();
  if (!alive) {
    return {
      status: "retry",
      errorMessage: "lease_lost",
      backoffSeconds: 30,
    };
  }

  const payload = (job.payload ?? {}) as {
    importJobId?: string;
    listId?: string;
    cursorRowNumber?: number;
    actorId?: string;
    actorName?: string;
  };

  if (!payload.importJobId || !payload.listId) {
    return {
      status: "failed",
      errorMessage: "importJobId/listId required",
    };
  }
  const actorId = payload.actorId ?? job.created_by;
  if (!actorId) {
    return {
      status: "failed",
      errorMessage: "prospect import actorId required",
    };
  }

  try {
    const result = await processProspectImportChunk({
      importJobId: payload.importJobId,
      listId: payload.listId,
      queueJobId: job.id,
      workerId: ctx.workerId,
      cursorRowNumber: payload.cursorRowNumber ?? 0,
      actorId,
      actorName: payload.actorName ?? "system",
      heartbeat: ctx.heartbeat,
    });
    return {
      status: "succeeded",
      result: { ...result },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "prospect_csv_import_failed";
    if (job.attempts >= job.max_attempts) {
      try {
        await failProspectImportJobIfCurrent({
          importJobId: payload.importJobId,
          listId: payload.listId,
          queueJobId: job.id,
          workerId: ctx.workerId,
          actorId,
          actorName: payload.actorName ?? "system",
        });
      } catch {
        // The archive RPC independently reconciles a terminal queue pointer,
        // so a lost finalizer response cannot block the list forever.
      }
    }
    if (isTerminalProspectImportErrorMessage(message)) {
      return { status: "failed", errorMessage: message };
    }
    const safeMessage =
      message === "lease_lost"
        ? message
        : PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE;
    if (job.attempts >= job.max_attempts) {
      return { status: "failed", errorMessage: safeMessage };
    }
    return {
      status: "retry",
      errorMessage: safeMessage,
      backoffSeconds: 60,
    };
  }
};

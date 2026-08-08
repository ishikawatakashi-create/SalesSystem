import "server-only";

import { processProspectImportChunk } from "@/lib/prospects/import";
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

  try {
    const result = await processProspectImportChunk({
      importJobId: payload.importJobId,
      listId: payload.listId,
      cursorRowNumber: payload.cursorRowNumber ?? 0,
      actorId: payload.actorId ?? job.created_by ?? "system",
      actorName: payload.actorName ?? "system",
      enqueueNext: true,
    });
    return {
      status: "succeeded",
      result: { ...result },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "prospect_csv_import_failed";
    return {
      status: "retry",
      errorMessage: message,
      backoffSeconds: 60,
    };
  }
};

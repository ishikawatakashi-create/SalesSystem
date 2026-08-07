import "server-only";

import type { JobHandler } from "@/lib/jobs/types";
import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { CSV_IMPORT_CHUNK_SIZE } from "@/lib/csv/limits";
import { validateAndStageImport } from "@/lib/csv/validate-and-stage";
import { processImportRow } from "@/lib/csv/process-row";
import type { ImportEntity } from "@/lib/csv/entities";
import type { ImportRowStatus } from "@/types/database";
import { uuidV5 } from "@/lib/notion/ids";

type CsvImportPayload = {
  importJobId: string;
  mode?: "validate" | "import" | "retry_failed";
  cursor?: { lastRowNumber: number };
  chainId?: string;
  processed?: number;
  imported?: number;
  failed?: number;
  actorId?: string;
  actorName?: string;
};

export const csvImportHandler: JobHandler = async (job, ctx) => {
  const admin = createAdminClient();
  const payload = (job.payload ?? {}) as CsvImportPayload;
  const { importJobId, mode = "import", cursor, chainId: inputChainId } =
    payload;
  const chainId = inputChainId ?? job.id;
  let processed = payload.processed ?? 0;
  let imported = payload.imported ?? 0;
  let failed = payload.failed ?? 0;

  try {
    const alive = await ctx.heartbeat();
    if (!alive) {
      return {
        status: "retry",
        errorMessage: "lease_lost",
        backoffSeconds: 30,
      };
    }

    const { data: importJob, error: loadError } = await admin
      .from("import_jobs")
      .select("*")
      .eq("id", importJobId)
      .maybeSingle();

    if (loadError || !importJob) {
      return {
        status: "failed",
        errorMessage: "import_job_not_found",
      };
    }

    if (importJob.cancel_requested_at) {
      await admin
        .from("import_jobs")
        .update({ status: "cancelled" })
        .eq("id", importJobId);
      return {
        status: "succeeded",
        result: { cancelled: true },
      };
    }

    const actorId =
      payload.actorId ??
      (importJob.created_by as string) ??
      (job.created_by as string) ??
      "";
    const { data: actor } = actorId
      ? await admin
          .from("app_users")
          .select("display_name")
          .eq("id", actorId)
          .maybeSingle()
      : { data: null };
    const actorName =
      payload.actorName ?? (actor?.display_name as string) ?? "csv_import";

    if (mode === "validate") {
      await validateAndStageImport({
        importJobId,
        actorId,
        actorName,
      });
      return { status: "succeeded", result: { mode: "validate" } };
    }

    const lastRowNumber = cursor?.lastRowNumber ?? 0;
    const statusFilter: ImportRowStatus[] =
      mode === "retry_failed"
        ? ["import_failed"]
        : ["valid_new", "valid_update", "skipped"];

    if (lastRowNumber === 0) {
      await admin
        .from("import_jobs")
        .update({ status: "importing" })
        .eq("id", importJobId);
      await admin.from("audit_logs").insert({
        actor_id: actorId || null,
        actor_name: actorName,
        action: "import.started",
        entity_type: "import_job",
        notion_page_id: null,
        changed_fields: { import_job_id: importJobId },
        operation_source: "csv_import",
        request_id: uuidV5(`import:started:${importJobId}:${chainId}`),
      } as never);
    }

    const { data: rows, error: selectError } = await admin
      .from("import_rows")
      .select("*")
      .eq("import_job_id", importJobId)
      .in("status", statusFilter)
      .gt("row_number", lastRowNumber)
      .order("row_number", { ascending: true })
      .limit(CSV_IMPORT_CHUNK_SIZE);

    if (selectError) {
      return {
        status: "failed",
        errorMessage: "select_rows_failed",
      };
    }

    if (!rows || rows.length === 0) {
      await finalizeImportJob(admin, importJobId, actorId, actorName);
      return {
        status: "succeeded",
        result: { final: true, processed, imported, failed },
      };
    }

    const entityType = importJob.entity_type as ImportEntity;

    for (const row of rows) {
      const stillAlive = await ctx.heartbeat();
      if (!stillAlive) {
        return {
          status: "retry",
          errorMessage: "lease_lost_during_chunk",
          backoffSeconds: 30,
        };
      }

      // cancel check
      const { data: fresh } = await admin
        .from("import_jobs")
        .select("cancel_requested_at")
        .eq("id", importJobId)
        .maybeSingle();
      if (fresh?.cancel_requested_at) {
        await admin
          .from("import_jobs")
          .update({ status: "cancelled" })
          .eq("id", importJobId);
        return { status: "succeeded", result: { cancelled: true } };
      }

      if (row.status === "skipped" || row.decision === "skip") {
        await admin
          .from("import_rows")
          .update({ status: "skipped" })
          .eq("id", row.id);
        processed += 1;
        continue;
      }

      await admin
        .from("import_rows")
        .update({ status: "importing" })
        .eq("id", row.id);

      const result = await processImportRow({
        admin,
        importJobId,
        entityType,
        actorId,
        actorName,
        row: {
          id: row.id as string,
          row_number: row.row_number as number,
          external_id: (row.external_id as string) ?? null,
          decision: (row.decision as string) ?? null,
          matched_page_id: (row.matched_page_id as string) ?? null,
          notion_page_id: (row.notion_page_id as string) ?? null,
          staged: (row.staged as Record<string, unknown>) ?? null,
          status: row.status as string,
        },
      });

      if (result.ok) {
        await admin
          .from("import_rows")
          .update({
            status: "imported",
            notion_page_id: result.notionPageId ?? null,
            external_id: result.externalId ?? row.external_id,
            error_message: null,
          })
          .eq("id", row.id);
        imported += 1;
      } else {
        await admin
          .from("import_rows")
          .update({
            status: "import_failed",
            retry_count: Number(row.retry_count ?? 0) + 1,
            error_message: result.errorCode ?? "import_failed",
            reason_codes: [{ code: result.errorCode ?? "import_failed" }] as never,
          })
          .eq("id", row.id);
        failed += 1;
      }
      processed += 1;
    }

    const newCursor = {
      lastRowNumber: rows[rows.length - 1]!.row_number as number,
    };

    await admin
      .from("import_jobs")
      .update({ last_processed_at: new Date().toISOString() })
      .eq("id", importJobId);

    await enqueueJob({
      kind: "csv_import",
      payload: {
        importJobId,
        mode,
        cursor: newCursor,
        chainId,
        processed,
        imported,
        failed,
        actorId,
        actorName,
      },
      idempotencyKey: `csv_import:${chainId}:${mode}:${newCursor.lastRowNumber}`,
      createdBy: job.created_by,
      priority: 50,
    });

    return {
      status: "succeeded",
      result: { chunk: true, processed, imported, failed },
    };
  } catch {
    return {
      status: "failed",
      errorMessage: "csv_import_failed",
    };
  }
};

async function finalizeImportJob(
  admin: ReturnType<typeof createAdminClient>,
  importJobId: string,
  actorId: string,
  actorName: string,
): Promise<void> {
  const { count: failedCount } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", importJobId)
    .eq("status", "import_failed");
  const { count: importedCount } = await admin
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", importJobId)
    .eq("status", "imported");
  const status =
    (failedCount ?? 0) > 0 ? "partially_completed" : "completed";
  await admin
    .from("import_jobs")
    .update({
      status,
      summary: {
        imported: importedCount ?? 0,
        failed: failedCount ?? 0,
        completedAt: new Date().toISOString(),
      },
    })
    .eq("id", importJobId);

  await admin.from("audit_logs").insert({
    actor_id: actorId || null,
    actor_name: actorName,
    action: "import.completed",
    entity_type: "import_job",
    notion_page_id: null,
    changed_fields: {
      import_job_id: importJobId,
      status,
      imported: importedCount ?? 0,
      failed: failedCount ?? 0,
    },
    operation_source: "csv_import",
    request_id: uuidV5(`import:completed:${importJobId}`),
  } as never);
}

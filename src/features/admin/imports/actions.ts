"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission, requireUser } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { createImportUploadUrl } from "@/lib/csv/storage";
import { downloadImportObject } from "@/lib/csv/storage";
import { decodeCsvBuffer } from "@/lib/csv/encoding";
import { parseCsv } from "@/lib/csv/parser";
import { suggestMapping, validateMapping } from "@/lib/csv/mapping";
import { getCsvTemplate } from "@/lib/csv/templates";
import {
  IMPORT_ENTITIES,
  type ImportEntity,
  ENTITY_DISPLAY_NAMES,
} from "@/lib/csv/entities";
import { CSV_MAX_FILE_BYTES } from "@/lib/csv/limits";
import { enqueueJob } from "@/lib/jobs/queue";
import { sanitizeCsvCellForExport } from "@/lib/csv/formula-injection";
import { uuidV5 } from "@/lib/notion/ids";

function isEntity(v: string): v is ImportEntity {
  return (IMPORT_ENTITIES as readonly string[]).includes(v);
}

export async function beginCsvUpload(input: {
  entityType: string;
  fileName: string;
  fileSize: number;
}) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  if (!isEntity(input.entityType)) {
    return { ok: false as const, error: "invalid_entity" };
  }
  if (!input.fileName.toLowerCase().endsWith(".csv")) {
    return { ok: false as const, error: "csv_only" };
  }
  if (input.fileSize <= 0 || input.fileSize > CSV_MAX_FILE_BYTES) {
    return { ok: false as const, error: "file_size" };
  }
  const importJobId = randomUUID();
  const result = await createImportUploadUrl({
    userId: user.id,
    importJobId,
    fileName: input.fileName.slice(0, 200),
    fileSize: input.fileSize,
    entityType: input.entityType,
  });
  await createAdminClient().from("audit_logs").insert({
    actor_id: user.id,
    actor_name: user.display_name,
    action: "import.created",
    entity_type: "import_job",
    notion_page_id: null,
    changed_fields: {
      import_job_id: importJobId,
      entity_type: input.entityType,
      file_name: input.fileName.slice(0, 200),
    },
    operation_source: "csv_import",
    request_id: uuidV5(`import:created:${importJobId}`),
  } as never);
  return {
    ok: true as const,
    importJobId: result.importJobId,
    signedUploadUrl: result.signedUploadUrl,
    storagePath: result.storagePath,
  };
}

export async function completeCsvUpload(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }

  const buf = await downloadImportObject(String(job.storage_path));
  const { text, encoding } = decodeCsvBuffer(buf, "auto");
  const parsed = parseCsv(text);
  const entity = job.entity_type as ImportEntity;
  const suggested = suggestMapping(parsed.headers, entity);

  await admin
    .from("import_jobs")
    .update({
      status: "mapping_required",
      detected_encoding: encoding,
      row_count: parsed.rows.length,
      column_mapping: suggested,
      summary: {
        headers: parsed.headers,
        sampleRowCount: Math.min(5, parsed.rows.length),
      },
    })
    .eq("id", importJobId);

  revalidatePath(`/admin/imports/${importJobId}`);
  return {
    ok: true as const,
    headers: parsed.headers,
    suggested,
    rowCount: parsed.rows.length,
    encoding,
  };
}

export async function saveCsvMapping(input: {
  importJobId: string;
  mapping: Record<string, string | null>;
  defaultDecision?: "create" | "update" | "skip" | null;
}) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", input.importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  const entity = job.entity_type as ImportEntity;
  const validation = validateMapping(input.mapping, entity);
  const hard = validation.errors.filter((e) => e.code !== "unsupported_field");
  await admin
    .from("import_jobs")
    .update({
      column_mapping: input.mapping,
      default_decision: input.defaultDecision ?? null,
    })
    .eq("id", input.importJobId);
  revalidatePath(`/admin/imports/${input.importJobId}`);
  return {
    ok: hard.length === 0,
    errors: validation.errors.map((e) => ({
      code: e.code,
      fieldKey: e.fieldKey,
    })),
  };
}

export async function runCsvValidation(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("created_by")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  await enqueueJob({
    kind: "csv_import",
    payload: {
      importJobId,
      mode: "validate",
      actorId: user.id,
      actorName: user.display_name,
    },
    idempotencyKey: `csv_validate:${importJobId}:${Date.now()}`,
    createdBy: user.id,
    priority: 40,
  });
  revalidatePath(`/admin/imports/${importJobId}`);
  return { ok: true as const };
}

export async function startCsvImport(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  if (job.status === "completed") {
    return { ok: false as const, error: "already_completed" };
  }
  if (!["ready", "failed", "partially_completed"].includes(String(job.status))) {
    return { ok: false as const, error: "not_ready" };
  }
  await enqueueJob({
    kind: "csv_import",
    payload: {
      importJobId,
      mode: "import",
      actorId: user.id,
      actorName: user.display_name,
    },
    idempotencyKey: `csv_import_start:${importJobId}:${Date.now()}`,
    createdBy: user.id,
    priority: 40,
  });
  revalidatePath(`/admin/imports/${importJobId}`);
  return { ok: true as const };
}

export async function cancelCsvImport(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  await admin
    .from("import_jobs")
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", importJobId);
  await admin.from("audit_logs").insert({
    actor_id: user.id,
    actor_name: user.display_name,
    action: "import.cancelled",
    entity_type: "import_job",
    notion_page_id: null,
    changed_fields: { import_job_id: importJobId },
    operation_source: "csv_import",
    request_id: uuidV5(`import:cancelled:${importJobId}:${Date.now()}`),
  } as never);
  revalidatePath(`/admin/imports/${importJobId}`);
  return { ok: true as const };
}

export async function retryFailedCsvRows(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  await enqueueJob({
    kind: "csv_import",
    payload: {
      importJobId,
      mode: "retry_failed",
      actorId: user.id,
      actorName: user.display_name,
    },
    idempotencyKey: `csv_retry:${importJobId}:${Date.now()}`,
    createdBy: user.id,
    priority: 40,
  });
  revalidatePath(`/admin/imports/${importJobId}`);
  return { ok: true as const };
}

export async function buildErrorCsv(importJobId: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("import_jobs")
    .select("created_by")
    .eq("id", importJobId)
    .maybeSingle();
  if (!job) return { ok: false as const, error: "not_found" };
  if (job.created_by !== user.id && user.role !== "admin") {
    return { ok: false as const, error: "forbidden" };
  }
  const { data: rows } = await admin
    .from("import_rows")
    .select("row_number,source_key,status,error_message,reason_codes")
    .eq("import_job_id", importJobId)
    .in("status", ["invalid", "import_failed"])
    .order("row_number", { ascending: true })
    .limit(5000);
  const header = ["row_number", "source_key", "status", "reason"].join(",");
  const lines = (rows ?? []).map((r) =>
    [
      String(r.row_number),
      sanitizeCsvCellForExport(String(r.source_key ?? "")),
      sanitizeCsvCellForExport(String(r.status ?? "")),
      sanitizeCsvCellForExport(
        String(r.error_message ?? JSON.stringify(r.reason_codes ?? [])),
      ),
    ].join(","),
  );
  return {
    ok: true as const,
    csv: [header, ...lines].join("\r\n"),
    filename: `import_errors.csv`,
  };
}

export async function listImportEntities() {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  return IMPORT_ENTITIES.map((e) => ({
    key: e,
    label: ENTITY_DISPLAY_NAMES[e],
  }));
}

export async function getTemplateCsv(entityType: string) {
  const user = await requireUser();
  requirePermission(user, "csv.import");
  if (!isEntity(entityType)) return { ok: false as const, error: "invalid_entity" };
  const t = getCsvTemplate(entityType);
  return { ok: true as const, ...t };
}

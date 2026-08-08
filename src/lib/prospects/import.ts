import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { decodeCsvBuffer } from "@/lib/csv/encoding";
import { parseCsv } from "@/lib/csv/parser";
import { normalizeEmailOrNull } from "@/lib/normalize/email";
import { normalizeUrl } from "@/lib/normalize/url";
import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeProspectAudit } from "@/lib/prospects/audit";
import {
  type ProspectColumnMapping,
  suggestProspectMapping,
  unmappedHeaders,
} from "@/lib/prospects/import-mapping";
import { filterSourceAttributes } from "@/lib/prospects/normalize";
import { upsertProspectFromImport } from "@/lib/prospects/upsert";
import type { ProspectStagedRow } from "@/lib/prospects/types";

const IMPORT_BUCKET = "imports";
const CHUNK_SIZE = 40;

function cell(
  row: Record<string, string>,
  mapping: ProspectColumnMapping,
  field: keyof ProspectColumnMapping,
): string {
  const header = mapping[field];
  if (!header) return "";
  return (row[header] ?? "").trim();
}

export function mapRawRowToStaged(
  headers: string[],
  values: string[],
  mapping: ProspectColumnMapping,
): ProspectStagedRow {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    row[h] = values[i] ?? "";
  });
  const mappedHeaders = new Set(
    Object.values(mapping).filter((v): v is string => Boolean(v)),
  );
  const sourceAttributes: Record<string, unknown> = {};
  for (const h of headers) {
    if (!mappedHeaders.has(h) && row[h]) {
      sourceAttributes[h] = row[h];
    }
  }

  const emailRaw = cell(row, mapping, "contactEmail");
  const websiteRaw = cell(row, mapping, "websiteUrl");

  return {
    companyName: cell(row, mapping, "companyName"),
    websiteUrl: websiteRaw || null,
    domain: cell(row, mapping, "domain") || null,
    mainPhone: cell(row, mapping, "mainPhone") || null,
    postalCode: cell(row, mapping, "postalCode") || null,
    prefecture: cell(row, mapping, "prefecture") || null,
    city: cell(row, mapping, "city") || null,
    address: cell(row, mapping, "address") || null,
    industry: cell(row, mapping, "industry") || null,
    employeeRange: cell(row, mapping, "employeeRange") || null,
    contactName: cell(row, mapping, "contactName") || null,
    contactDepartment: cell(row, mapping, "contactDepartment") || null,
    contactTitle: cell(row, mapping, "contactTitle") || null,
    contactEmail: emailRaw || null,
    contactPhone: cell(row, mapping, "contactPhone") || null,
    externalRecordId: cell(row, mapping, "externalRecordId") || null,
    notes: cell(row, mapping, "notes") || null,
    sourceAttributes: filterSourceAttributes(sourceAttributes),
  };
}

export function validateStagedRow(staged: ProspectStagedRow): {
  ok: boolean;
  warnings: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!staged.companyName.trim()) errors.push("会社名は必須です");
  if (staged.contactEmail && !normalizeEmailOrNull(staged.contactEmail)) {
    warnings.push("メール形式が不正です");
  }
  if (staged.websiteUrl && !normalizeUrl(staged.websiteUrl)) {
    warnings.push("URL形式が不正です");
  }
  return { ok: errors.length === 0, warnings, errors };
}

export async function createProspectImportUpload(input: {
  userId: string;
  listId: string;
  fileName: string;
  fileSize: number;
}): Promise<{
  importJobId: string;
  signedUploadUrl: string;
  storagePath: string;
}> {
  const admin = createAdminClient();
  const importJobId = randomUUID();
  const storagePath = `prospects/${input.userId}/${importJobId}/${randomUUID()}.csv`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const { error } = await admin.from("prospect_import_jobs").insert({
    id: importJobId,
    prospect_list_id: input.listId,
    file_name: input.fileName,
    storage_path: storagePath,
    file_size: input.fileSize,
    status: "uploaded",
    expires_at: expiresAt.toISOString(),
    created_by: input.userId,
  });
  if (error) throw new Error(error.message);

  const { data: uploadData, error: uploadError } = await admin.storage
    .from(IMPORT_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (uploadError || !uploadData) {
    throw new Error(uploadError?.message ?? "signed upload failed");
  }

  return {
    importJobId,
    signedUploadUrl: uploadData.signedUrl,
    storagePath,
  };
}

export async function prepareProspectImport(input: {
  importJobId: string;
  mapping?: ProspectColumnMapping;
}): Promise<{
  headers: string[];
  suggestedMapping: ProspectColumnMapping;
  mapping: ProspectColumnMapping;
  unmapped: string[];
  preview: Array<{
    rowNumber: number;
    staged: ProspectStagedRow;
    ok: boolean;
    warnings: string[];
    errors: string[];
  }>;
  totalRows: number;
  encoding: string;
}> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("prospect_import_jobs")
    .select("*")
    .eq("id", input.importJobId)
    .single();
  if (error || !job) throw new Error(error?.message ?? "job not found");

  const { data: file, error: dlErr } = await admin.storage
    .from(IMPORT_BUCKET)
    .download(job.storage_path as string);
  if (dlErr || !file) throw new Error(dlErr?.message ?? "download failed");

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const decoded = decodeCsvBuffer(buf, "auto");
  const parsed = parseCsv(decoded.text);
  const suggested = suggestProspectMapping(parsed.headers);
  const mapping = input.mapping ?? suggested;
  const preview = parsed.rows.slice(0, 20).map((values, idx) => {
    const staged = mapRawRowToStaged(parsed.headers, values, mapping);
    const v = validateStagedRow(staged);
    return {
      rowNumber: parsed.rowNumbers[idx] ?? idx + 2,
      staged,
      ok: v.ok,
      warnings: v.warnings,
      errors: v.errors,
    };
  });

  await admin
    .from("prospect_import_jobs")
    .update({
      column_mapping: mapping,
      encoding: decoded.encoding,
      file_sha256: sha256,
      total_rows: parsed.rows.length,
      status: "mapped",
    })
    .eq("id", input.importJobId);

  return {
    headers: parsed.headers,
    suggestedMapping: suggested,
    mapping,
    unmapped: unmappedHeaders(parsed.headers, mapping),
    preview,
    totalRows: parsed.rows.length,
    encoding: decoded.encoding,
  };
}

export async function stageAndEnqueueProspectImport(input: {
  importJobId: string;
  mapping: ProspectColumnMapping;
  actorId: string;
  actorName: string;
}): Promise<{ totalRows: number; jobEnqueued: boolean }> {
  const admin = createAdminClient();
  await prepareProspectImport({
    importJobId: input.importJobId,
    mapping: input.mapping,
  });

  const { data: job } = await admin
    .from("prospect_import_jobs")
    .select("storage_path,prospect_list_id")
    .eq("id", input.importJobId)
    .single();
  if (!job) throw new Error("job not found");

  const { data: file } = await admin.storage
    .from(IMPORT_BUCKET)
    .download(job.storage_path as string);
  if (!file) throw new Error("download failed");
  const buf = Buffer.from(await file.arrayBuffer());
  const decoded = decodeCsvBuffer(buf, "auto");
  const parsed = parseCsv(decoded.text);

  // Replace staged rows
  await admin
    .from("prospect_import_rows")
    .delete()
    .eq("prospect_import_job_id", input.importJobId);

  const inserts = parsed.rows.map((values, idx) => {
    const staged = mapRawRowToStaged(parsed.headers, values, input.mapping);
    const v = validateStagedRow(staged);
    const raw: Record<string, string> = {};
    parsed.headers.forEach((h, i) => {
      raw[h] = values[i] ?? "";
    });
    return {
      prospect_import_job_id: input.importJobId,
      row_number: parsed.rowNumbers[idx] ?? idx + 2,
      raw,
      staged,
      status: v.ok ? "pending" : "invalid",
      source_record_id: staged.externalRecordId,
      error_message: v.errors.join("; ") || null,
    };
  });

  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const { error } = await admin.from("prospect_import_rows").insert(chunk);
    if (error) throw new Error(error.message);
  }

  await admin
    .from("prospect_import_jobs")
    .update({
      status: "ready",
      column_mapping: input.mapping,
      total_rows: inserts.length,
      invalid_count: inserts.filter((r) => r.status === "invalid").length,
    })
    .eq("id", input.importJobId);

  await enqueueJob({
    kind: "prospect_csv_import",
    payload: {
      importJobId: input.importJobId,
      listId: job.prospect_list_id,
      cursorRowNumber: 0,
      actorId: input.actorId,
      actorName: input.actorName,
    },
    priority: 40,
    idempotencyKey: `prospect_csv_import:${input.importJobId}:start`,
    createdBy: input.actorId,
  });

  await writeProspectAudit({
    actorId: input.actorId,
    actorName: input.actorName,
    action: "prospect_import.committed",
    entityType: "prospect_import",
    entityId: input.importJobId,
    changedFields: { total_rows: inserts.length },
  });

  return { totalRows: inserts.length, jobEnqueued: true };
}

export async function processProspectImportChunk(input: {
  importJobId: string;
  listId: string;
  cursorRowNumber: number;
  actorId: string;
  actorName: string;
  enqueueNext?: boolean;
}): Promise<{
  done: boolean;
  nextCursor: number;
  accepted: number;
  reused: number;
  probable: number;
  invalid: number;
  skipped: number;
  failed: number;
}> {
  const admin = createAdminClient();
  await admin
    .from("prospect_import_jobs")
    .update({ status: "importing" })
    .eq("id", input.importJobId);

  const { data: rows, error } = await admin
    .from("prospect_import_rows")
    .select("*")
    .eq("prospect_import_job_id", input.importJobId)
    .eq("status", "pending")
    .gt("row_number", input.cursorRowNumber)
    .order("row_number", { ascending: true })
    .limit(CHUNK_SIZE);
  if (error) throw new Error(error.message);

  let accepted = 0;
  let reused = 0;
  let probable = 0;
  let invalid = 0;
  let skipped = 0;
  let failed = 0;
  let nextCursor = input.cursorRowNumber;

  for (const row of rows ?? []) {
    nextCursor = row.row_number as number;
    const staged = row.staged as ProspectStagedRow;
    const result = await upsertProspectFromImport({
      listId: input.listId,
      staged,
      actorId: input.actorId,
      actorName: input.actorName,
      importJobId: input.importJobId,
    });
    await admin
      .from("prospect_import_rows")
      .update({
        status: result.status,
        prospect_id: result.prospectId,
        membership_id: result.membershipId,
        match_reason: result.matchReason,
        error_message: result.errorMessage,
      })
      .eq("id", String(row.id));

    switch (result.status) {
      case "accepted":
        accepted += 1;
        break;
      case "reused":
        reused += 1;
        break;
      case "probable_duplicate":
        probable += 1;
        break;
      case "invalid":
        invalid += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      default:
        failed += 1;
    }
  }

  // refresh counters
  const { data: job } = await admin
    .from("prospect_import_jobs")
    .select(
      "accepted_count,reused_count,probable_duplicate_count,invalid_count,skipped_count",
    )
    .eq("id", input.importJobId)
    .single();
  const jobCounts = (job ?? {}) as {
    accepted_count?: number;
    reused_count?: number;
    probable_duplicate_count?: number;
    invalid_count?: number;
    skipped_count?: number;
  };

  const { count: pendingLeft } = await admin
    .from("prospect_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("prospect_import_job_id", input.importJobId)
    .eq("status", "pending");

  const done = (pendingLeft ?? 0) === 0;
  await admin
    .from("prospect_import_jobs")
    .update({
      accepted_count: Number(jobCounts.accepted_count ?? 0) + accepted,
      reused_count: Number(jobCounts.reused_count ?? 0) + reused,
      probable_duplicate_count:
        Number(jobCounts.probable_duplicate_count ?? 0) + probable,
      invalid_count: Number(jobCounts.invalid_count ?? 0) + invalid,
      skipped_count: Number(jobCounts.skipped_count ?? 0) + skipped,
      status: done ? "completed" : "importing",
      finished_at: done ? new Date().toISOString() : null,
    })
    .eq("id", input.importJobId);

  if (!done && input.enqueueNext !== false) {
    await enqueueJob({
      kind: "prospect_csv_import",
      payload: {
        importJobId: input.importJobId,
        listId: input.listId,
        cursorRowNumber: nextCursor,
        actorId: input.actorId,
        actorName: input.actorName,
      },
      priority: 40,
      idempotencyKey: `prospect_csv_import:${input.importJobId}:${nextCursor}`,
      createdBy: input.actorId,
    });
  }

  return {
    done,
    nextCursor,
    accepted,
    reused,
    probable,
    invalid,
    skipped,
    failed,
  };
}

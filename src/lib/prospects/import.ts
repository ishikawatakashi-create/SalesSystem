import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { decodeCsvBuffer } from "@/lib/csv/encoding";
import { parseCsv } from "@/lib/csv/parser";
import { normalizeEmailOrNull } from "@/lib/normalize/email";
import { normalizeUrl } from "@/lib/normalize/url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findFormalOrganizationMatches,
  type FormalOrgMatch,
} from "@/lib/prospects/formal-match";
import {
  type ProspectColumnMapping,
  suggestProspectMapping,
  unmappedHeaders,
} from "@/lib/prospects/import-mapping";
import {
  filterSourceAttributes,
  normalizePersonNameForCompare,
  stagedToNormalized,
} from "@/lib/prospects/normalize";
import type { ProspectStagedRow } from "@/lib/prospects/types";

const IMPORT_BUCKET = "imports";
const CHUNK_SIZE = 40;

type ProspectImportAdminClient = ReturnType<typeof createAdminClient>;

export const PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE =
  "取込先の営業リストが見つからないか、アーカイブ済みのため、CSVを取り込めません。営業リスト一覧から取込先を選び直してください。";
export const PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE =
  "営業リストの状態を確認できませんでした。画面を再読み込みして、もう一度お試しください。";
const PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE =
  "取込先の営業リストを確認できませんでした。画面を再読み込みして、CSVを選び直してください。";
const PROSPECT_IMPORT_INVALID_STATE_MESSAGE =
  "CSVの取込状態が変わっています。画面を再読み込みして、もう一度お試しください。";
const PROSPECT_IMPORT_NOT_FOUND_MESSAGE =
  "CSVの取込処理が見つかりません。画面を再読み込みして、CSVを選び直してください。";
export const PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE =
  "CSV取込処理を安全に続行できませんでした。自動で再試行します。";
const PROSPECT_IMPORT_ALREADY_STARTED_MESSAGE =
  "CSVの取込はすでに開始されています。営業リストへ戻って処理状況を確認してください。";
const PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE =
  "CSVの取込開始処理が進行中です。少し待ってから営業リストを確認してください。";

type ProspectImportRpcResult = Record<string, unknown> & {
  outcome?: string;
};

export type AtomicProspectImportRowPayload = {
  rowId: string;
  rowNumber: number;
  core: ReturnType<typeof stagedToNormalized>["core"];
  contact: ReturnType<typeof stagedToNormalized>["contact"] & {
    normalizedName: string;
  };
  sourceRowHash: string;
  sourceAttributes: Record<string, unknown>;
  externalRecordId: string | null;
  notes: string | null;
  formalMatch: Pick<
    FormalOrgMatch,
    "pageId" | "externalId" | "confidence" | "reason"
  > | null;
};

export function isTerminalProspectImportErrorMessage(message: string): boolean {
  return (
    message === PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE ||
    message === PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE
  );
}

export async function assertProspectListAcceptsImport(
  listId: string,
  dependencies: { admin?: ProspectImportAdminClient } = {},
): Promise<void> {
  const admin = dependencies.admin ?? createAdminClient();
  const { data: list, error } = await admin
    .from("prospect_lists")
    .select("id,status,archived_at")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw new Error(PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE);
  if (!list || list.status === "archived" || list.archived_at) {
    throw new Error(PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE);
  }
}

async function markProspectImportJobUnavailable(
  admin: ProspectImportAdminClient,
  importJobId: string,
  message: string,
): Promise<void> {
  await admin
    .from("prospect_import_jobs")
    .update({
      status: "failed",
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .eq("id", importJobId)
    .in("status", ["uploaded", "mapped", "validating"]);
}

async function assertImportJobListAcceptsImport(input: {
  admin: ProspectImportAdminClient;
  importJobId: string;
  listId: string;
}): Promise<void> {
  try {
    await assertProspectListAcceptsImport(input.listId, { admin: input.admin });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE;
    if (message === PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE) {
      await markProspectImportJobUnavailable(
        input.admin,
        input.importJobId,
        message,
      );
    }
    throw new Error(message);
  }
}

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

function rpcObject(value: unknown): ProspectImportRpcResult {
  return value && typeof value === "object"
    ? (value as ProspectImportRpcResult)
    : {};
}

function rpcNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function prospectImportStartOutcomeError(
  outcome: string | undefined,
): string | null {
  if (["started", "already_started", "already_completed"].includes(outcome ?? "")) {
    return null;
  }
  if (outcome === "list_unavailable") {
    return PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE;
  }
  if (outcome === "list_mismatch") {
    return PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE;
  }
  if (outcome === "import_not_found") {
    return PROSPECT_IMPORT_NOT_FOUND_MESSAGE;
  }
  return PROSPECT_IMPORT_INVALID_STATE_MESSAGE;
}

export function buildAtomicProspectImportRowPayload(input: {
  rowId: string;
  rowNumber: number;
  staged: ProspectStagedRow;
  formalMatch: FormalOrgMatch | null;
}): AtomicProspectImportRowPayload {
  const normalized = stagedToNormalized(input.staged);
  return {
    rowId: input.rowId,
    rowNumber: input.rowNumber,
    core: normalized.core,
    contact: {
      ...normalized.contact,
      normalizedName: normalizePersonNameForCompare(normalized.contact.name),
    },
    sourceRowHash: normalized.sourceRowHash,
    sourceAttributes: normalized.sourceAttributes,
    externalRecordId: input.staged.externalRecordId,
    notes: input.staged.notes,
    formalMatch: input.formalMatch
      ? {
          pageId: input.formalMatch.pageId,
          externalId: input.formalMatch.externalId,
          confidence: input.formalMatch.confidence,
          reason: input.formalMatch.reason,
        }
      : null,
  };
}

export async function failProspectImportJobIfCurrent(input: {
  importJobId: string;
  listId: string;
  queueJobId: string;
  workerId: string;
  actorId: string;
  actorName: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "fail_prospect_import_job_if_current",
    {
      p_import_job_id: input.importJobId,
      p_list_id: input.listId,
      p_queue_job_id: input.queueJobId,
      p_worker_id: input.workerId,
      p_actor_id: input.actorId,
      p_actor_name: input.actorName,
    },
  );
  if (error) throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);

  const outcome = rpcObject(data).outcome;
  if (outcome === "failed") return true;
  if (
    [
      "terminal_noop",
      "stale_noop",
      "lease_lost",
      "retry_remaining",
      "list_unavailable",
      "list_mismatch",
      "import_not_found",
      "invalid_state",
      "queue_mismatch",
    ].includes(String(outcome))
  ) {
    return false;
  }
  throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);
}

async function prepareAtomicProspectImportRows(input: {
  rows: Array<Record<string, unknown>>;
  heartbeat?: () => Promise<boolean>;
}): Promise<AtomicProspectImportRowPayload[]> {
  const prepared: AtomicProspectImportRowPayload[] = [];
  for (const row of input.rows) {
    if (input.heartbeat && !(await input.heartbeat())) {
      throw new Error("lease_lost");
    }
    const staged = row.staged as ProspectStagedRow;
    const normalized = stagedToNormalized(staged);
    const formalMatches = await findFormalOrganizationMatches({
      normalizedDomain: normalized.core.normalizedDomain,
      normalizedPhone: normalized.core.normalizedPhone,
    });
    prepared.push(
      buildAtomicProspectImportRowPayload({
        rowId: String(row.id),
        rowNumber: Number(row.row_number),
        staged,
        formalMatch: formalMatches[0] ?? null,
      }),
    );
  }
  return prepared;
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
  await assertProspectListAcceptsImport(input.listId, { admin });
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
  if (error) throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);

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
    .maybeSingle();
  if (error || !job) {
    throw new Error(
      "CSVの取込処理が見つかりません。画面を再読み込みして、CSVを選び直してください。",
    );
  }
  const currentStatus = String(job.status ?? "");
  if (["ready", "importing", "completed"].includes(currentStatus)) {
    throw new Error(PROSPECT_IMPORT_ALREADY_STARTED_MESSAGE);
  }
  if (currentStatus === "validating") {
    throw new Error(PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE);
  }
  if (["failed", "cancelled"].includes(currentStatus)) {
    throw new Error(PROSPECT_IMPORT_INVALID_STATE_MESSAGE);
  }
  const listId =
    typeof job.prospect_list_id === "string" ? job.prospect_list_id : "";
  if (!listId) throw new Error(PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE);
  await assertImportJobListAcceptsImport({
    admin,
    importJobId: input.importJobId,
    listId,
  });

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

  await assertImportJobListAcceptsImport({
    admin,
    importJobId: input.importJobId,
    listId,
  });
  const { data: mapped, error: mappedError } = await admin
    .from("prospect_import_jobs")
    .update({
      column_mapping: mapping,
      encoding: decoded.encoding,
      file_sha256: sha256,
      total_rows: parsed.rows.length,
      status: "mapped",
    })
    .eq("id", input.importJobId)
    .in("status", ["uploaded", "mapped"])
    .select("id")
    .maybeSingle();
  if (mappedError) throw new Error(PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE);
  if (!mapped) throw new Error(PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE);

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
  expectedListId?: string;
}): Promise<{ totalRows: number; jobEnqueued: boolean }> {
  const admin = createAdminClient();
  const loadJob = async (): Promise<Record<string, unknown>> => {
    const { data: job, error } = await admin
      .from("prospect_import_jobs")
      .select("storage_path,prospect_list_id,status,total_rows")
      .eq("id", input.importJobId)
      .maybeSingle();
    if (error || !job) throw new Error(PROSPECT_IMPORT_NOT_FOUND_MESSAGE);
    return job as Record<string, unknown>;
  };
  const existingStartResult = (
    job: Record<string, unknown>,
  ): { totalRows: number; jobEnqueued: boolean } | null => {
    const status = String(job.status ?? "");
    if (["ready", "importing", "completed"].includes(status)) {
      return {
        totalRows: Number(job.total_rows ?? 0),
        jobEnqueued: status !== "completed",
      };
    }
    if (status === "validating") {
      throw new Error(PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE);
    }
    if (["failed", "cancelled"].includes(status)) {
      throw new Error(PROSPECT_IMPORT_INVALID_STATE_MESSAGE);
    }
    return null;
  };
  const verifyListIdentity = async (
    job: Record<string, unknown>,
  ): Promise<string> => {
    const listId =
      typeof job.prospect_list_id === "string" ? job.prospect_list_id : "";
    if (!listId || (input.expectedListId && input.expectedListId !== listId)) {
      await markProspectImportJobUnavailable(
        admin,
        input.importJobId,
        PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE,
      );
      throw new Error(PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE);
    }
    return listId;
  };

  let job = await loadJob();
  let listId = await verifyListIdentity(job);
  const initialResult = existingStartResult(job);
  if (initialResult) return initialResult;

  try {
    await prepareProspectImport({
      importJobId: input.importJobId,
      mapping: input.mapping,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        PROSPECT_IMPORT_ALREADY_STARTED_MESSAGE,
        PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE,
      ].includes(error.message)
    ) {
      job = await loadJob();
      listId = await verifyListIdentity(job);
      const concurrentResult = existingStartResult(job);
      if (concurrentResult) return concurrentResult;
    }
    throw error;
  }

  job = await loadJob();
  listId = await verifyListIdentity(job);
  const preparedResult = existingStartResult(job);
  if (preparedResult) return preparedResult;

  const { data: file } = await admin.storage
    .from(IMPORT_BUCKET)
    .download(job.storage_path as string);
  if (!file) throw new Error("download failed");
  const buf = Buffer.from(await file.arrayBuffer());
  const decoded = decodeCsvBuffer(buf, "auto");
  const parsed = parseCsv(decoded.text);

  const { data: claimed, error: claimError } = await admin
    .from("prospect_import_jobs")
    .update({ status: "validating" })
    .eq("id", input.importJobId)
    .eq("status", "mapped")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE);
  if (!claimed) {
    const latest = await loadJob();
    await verifyListIdentity(latest);
    const concurrentResult = existingStartResult(latest);
    if (concurrentResult) return concurrentResult;
    throw new Error(PROSPECT_IMPORT_COMMIT_IN_PROGRESS_MESSAGE);
  }

  try {
    await assertImportJobListAcceptsImport({
      admin,
      importJobId: input.importJobId,
      listId,
    });

    // Only the request that changed mapped -> validating may replace staging.
    const { error: deleteError } = await admin
      .from("prospect_import_rows")
      .delete()
      .eq("prospect_import_job_id", input.importJobId);
    if (deleteError) throw new Error(deleteError.message);

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

    const { data: started, error: startError } = await admin.rpc(
      "start_prospect_import_job",
      {
        p_import_job_id: input.importJobId,
        p_expected_list_id: listId,
        p_actor_id: input.actorId,
        p_actor_name: input.actorName,
        p_column_mapping: input.mapping,
      },
    );
    if (startError) {
      throw new Error(PROSPECT_IMPORT_LIST_CHECK_FAILED_MESSAGE);
    }

    const result = rpcObject(started);
    const outcomeError = prospectImportStartOutcomeError(result.outcome);
    if (outcomeError) throw new Error(outcomeError);
    switch (result.outcome) {
      case "started":
      case "already_started":
        return {
          totalRows: rpcNumber(result.totalRows) || inserts.length,
          jobEnqueued: true,
        };
      case "already_completed":
        return {
          totalRows: rpcNumber(result.totalRows) || inserts.length,
          jobEnqueued: false,
        };
      default:
        throw new Error(PROSPECT_IMPORT_INVALID_STATE_MESSAGE);
    }
  } catch (error) {
    // A lost response after a committed start sees ready/importing/completed,
    // so this compare-and-set cannot roll it back. Pre-start failures become
    // safely retryable with the already staged rows replaced on the next try.
    await admin
      .from("prospect_import_jobs")
      .update({ status: "mapped" })
      .eq("id", input.importJobId)
      .eq("status", "validating");
    throw error;
  }
}

export async function processProspectImportChunk(input: {
  importJobId: string;
  listId: string;
  queueJobId: string;
  workerId: string;
  cursorRowNumber: number;
  actorId: string;
  actorName: string;
  heartbeat?: () => Promise<boolean>;
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
  const { data: importJob, error: importJobError } = await admin
    .from("prospect_import_jobs")
    .select("prospect_list_id,status")
    .eq("id", input.importJobId)
    .maybeSingle();
  const jobListId =
    typeof importJob?.prospect_list_id === "string"
      ? importJob.prospect_list_id
      : "";
  if (importJobError || !jobListId || jobListId !== input.listId) {
    throw new Error(PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE);
  }
  if (["completed", "failed", "cancelled"].includes(String(importJob?.status))) {
    return {
      done: true,
      nextCursor: input.cursorRowNumber,
      accepted: 0,
      reused: 0,
      probable: 0,
      invalid: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const { data: rows, error } = await admin
    .from("prospect_import_rows")
    .select("*")
    .eq("prospect_import_job_id", input.importJobId)
    .eq("status", "pending")
    .gt("row_number", input.cursorRowNumber)
    .order("row_number", { ascending: true })
    .limit(CHUNK_SIZE);
  if (error) throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);

  const preparedRows = await prepareAtomicProspectImportRows({
    rows: (rows ?? []) as Array<Record<string, unknown>>,
    heartbeat: input.heartbeat,
  });

  // Payload preparation performs read-only matching work. Re-check the lease
  // immediately before the one transaction that is allowed to write.
  if (input.heartbeat && !(await input.heartbeat())) {
    throw new Error("lease_lost");
  }

  const { data: processed, error: processError } = await admin.rpc(
    "process_prospect_import_chunk_atomic",
    {
      p_import_job_id: input.importJobId,
      p_list_id: input.listId,
      p_queue_job_id: input.queueJobId,
      p_worker_id: input.workerId,
      p_cursor_row_number: input.cursorRowNumber,
      p_actor_id: input.actorId,
      p_actor_name: input.actorName,
      p_rows: preparedRows,
    },
  );
  if (processError) {
    throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);
  }

  const result = rpcObject(processed);
  if (["terminal_noop", "stale_noop"].includes(String(result.outcome))) {
    return {
      done: true,
      nextCursor: rpcNumber(result.nextCursor) || input.cursorRowNumber,
      accepted: 0,
      reused: 0,
      probable: 0,
      invalid: 0,
      skipped: 0,
      failed: 0,
    };
  }
  if (result.outcome === "list_unavailable") {
    throw new Error(PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE);
  }
  if (result.outcome === "list_mismatch") {
    throw new Error(PROSPECT_IMPORT_LIST_MISMATCH_MESSAGE);
  }
  if (result.outcome === "lease_lost") throw new Error("lease_lost");
  if (!["processed", "completed"].includes(String(result.outcome))) {
    throw new Error(PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE);
  }

  return {
    done: Boolean(result.done),
    nextCursor: rpcNumber(result.nextCursor) || input.cursorRowNumber,
    accepted: rpcNumber(result.accepted),
    reused: rpcNumber(result.reused),
    probable: rpcNumber(result.probable),
    invalid: rpcNumber(result.invalid),
    skipped: rpcNumber(result.skipped),
    failed: rpcNumber(result.failed),
  };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getHelpArticle } from "@/lib/help/articles";
import { listHelpFaqs } from "@/lib/help/faq";
import {
  buildAtomicProspectImportRowPayload,
  prospectImportStartOutcomeError,
  PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE,
} from "@/lib/prospects/import";
import {
  prospectListArchiveOutcomeError,
  PROSPECT_LIST_IMPORT_IN_PROGRESS_MESSAGE,
} from "@/lib/prospects/lists";
import { stagedToNormalized } from "@/lib/prospects/normalize";
import type { ProspectStagedRow } from "@/lib/prospects/types";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260811020000_atomic_prospect_import_archive.sql",
);
const repairMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260811030000_repair_atomic_prospect_import_functions.sql",
);

function functionSection(
  migration: string,
  name: string,
  nextName?: string,
): string {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start)
    : migration.length;
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("atomic prospect import / archive migration", () => {
  const migration = readFileSync(migrationPath, "utf8").toLowerCase();
  const start = functionSection(
    migration,
    "start_prospect_import_job",
    "fail_prospect_import_job_if_current",
  );
  const finalizer = functionSection(
    migration,
    "fail_prospect_import_job_if_current",
    "archive_prospect_list_if_idle",
  );
  const archive = functionSection(
    migration,
    "archive_prospect_list_if_idle",
    "process_prospect_import_chunk_atomic",
  );
  const chunk = functionSection(
    migration,
    "process_prospect_import_chunk_atomic",
  );

  it("locks list before import job in start and archive", () => {
    expect(start.indexOf("from public.prospect_lists")).toBeLessThan(
      start.indexOf("from public.prospect_import_jobs"),
    );
    expect(archive.indexOf("from public.prospect_lists")).toBeLessThan(
      archive.indexOf("from public.prospect_import_jobs"),
    );
    expect(start).toContain("for update");
    expect(archive).toContain("for update");
  });

  it("locks rows without skipping them so the cursor cannot strand pending rows", () => {
    const listLock = chunk.indexOf("from public.prospect_lists");
    const importLock = chunk.indexOf("from public.prospect_import_jobs");
    const queueLock = chunk.indexOf("from public.jobs");
    const rowLock = chunk.indexOf("from public.prospect_import_rows");
    const prospectWrite = chunk.indexOf("insert into public.prospects");
    expect(listLock).toBeLessThan(importLock);
    expect(importLock).toBeLessThan(queueLock);
    expect(queueLock).toBeLessThan(rowLock);
    expect(rowLock).toBeLessThan(prospectWrite);
    expect(chunk).toContain("for update of r");
    expect(chunk).not.toContain("skip locked");
    expect(chunk).toContain("pg_advisory_xact_lock");
    expect(chunk).toContain("order by all_keys.lock_key");
    expect(chunk.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      chunk.indexOf("for v_row in"),
    );
    expect(chunk).toContain("order by candidates.prospect_id");
    expect(chunk.indexOf("order by candidates.prospect_id")).toBeLessThan(
      chunk.indexOf("for v_row in"),
    );
  });

  it("atomically writes dedupe results, checkpoints and next queue job", () => {
    for (const token of [
      "insert into public.prospects",
      "insert into public.prospect_list_memberships",
      "insert into public.prospect_contacts",
      "update public.prospect_import_rows",
      "update public.prospect_import_jobs",
      "insert into public.jobs",
      "insert into public.audit_logs",
      "active_queue_job_id",
      "source_row_hash",
      "high:domain",
      "high:phone",
      "high:contact_email",
      "probable_duplicate",
    ]) {
      expect(chunk, token).toContain(token);
    }
  });

  it("returns structured start/archive/terminal outcomes", () => {
    expect(start).toContain("'outcome', 'started'");
    expect(start).toContain("'outcome', 'list_unavailable'");
    expect(start).toContain("v_import.status not in ('mapped', 'validating')");
    expect(archive).toContain("'outcome', 'import_in_progress'");
    expect(archive).toContain("'outcome', 'already_archived'");
    expect(finalizer).toContain("'outcome', 'failed'");
    expect(finalizer).toContain("'outcome', 'stale_noop'");
    expect(finalizer).toContain("v_queue.attempts < v_queue.max_attempts");
    expect(chunk).toContain("'outcome', 'terminal_noop'");
    expect(chunk).toContain("'outcome', 'stale_noop'");
    expect(migration).toContain("prospect_lists_guard_active_import");
    expect(migration).toContain("prospect_list_import_in_progress");
  });

  it("keeps every P1 RPC service-role only with an empty search_path", () => {
    expect(migration.match(/security definer set search_path = ''/g)).toHaveLength(
      4,
    );
    for (const name of [
      "start_prospect_import_job",
      "fail_prospect_import_job_if_current",
      "archive_prospect_list_if_idle",
      "process_prospect_import_chunk_atomic",
    ]) {
      expect(migration).toContain(`revoke execute on function public.${name}`);
      expect(migration).toContain(") from public, anon, authenticated;");
      expect(migration).toContain(`grant execute on function public.${name}`);
      expect(migration).toContain(") to service_role;");
    }
  });

  it("fails closed for legacy enqueue and enforces a quiet migration cutover", () => {
    expect(migration).toContain("jobs_guard_atomic_prospect_import_enqueue");
    expect(migration).toContain("atomic_prospect_import_enqueue_required");
    const importLock = migration.indexOf(
      "lock table public.prospect_import_jobs in share row exclusive mode",
    );
    const jobsLock = migration.indexOf(
      "lock table public.jobs in share row exclusive mode",
    );
    const guardDdl = migration.indexOf(
      "create or replace function public.guard_atomic_prospect_import_enqueue",
    );
    const preflight = migration.indexOf("requires zero active imports");
    expect(importLock).toBeGreaterThanOrEqual(0);
    expect(importLock).toBeLessThan(jobsLock);
    expect(jobsLock).toBeLessThan(guardDdl);
    expect(guardDdl).toBeLessThan(preflight);
    expect(migration).toContain("requires zero active imports");
    expect(migration).toContain("prospect_import_jobs_active_queue_required");
    expect(migration).toContain("status not in ('ready', 'importing')");
    expect(start).toContain("set_config(");
    expect(start).toContain("'app.atomic_prospect_import_enqueue'");
    expect(chunk).toContain("set_config(");
    expect(chunk).toContain("'app.atomic_prospect_import_enqueue'");
  });

  it("does not schema-qualify PostgreSQL COALESCE syntax", () => {
    const repair = readFileSync(repairMigrationPath, "utf8").toLowerCase();
    expect(migration).not.toContain("pg_catalog.coalesce");
    expect(repair).toContain("pg_get_functiondef");
    expect(repair).toContain("'pg_catalog.coalesce'");
    expect(repair).toContain("'coalesce'");
    for (const name of [
      "guard_atomic_prospect_import_enqueue",
      "start_prospect_import_job",
      "process_prospect_import_chunk_atomic",
    ]) {
      expect(repair).toContain(name);
    }
  });

  it("reconciles every terminal or orphan active import before archive", () => {
    expect(archive).toContain("loop");
    expect(archive).toContain("order by j.id");
    expect(archive).toContain("v_active_queue_status in ('succeeded', 'failed', 'cancelled')");
    expect(archive).toContain("not v_active_queue_found");
    expect(archive).toContain("v_scan_after_import_id");
    expect(archive).toContain("v_blocking_import_id");
    expect(archive).toContain("queue_pointer_missing_during_archive");
    expect(archive).toContain("queue_job_missing_during_archive");
    expect(archive).toContain("continue;");
    expect(archive).toContain("'outcome', 'import_in_progress'");
  });
});

describe("atomic prospect import service semantics", () => {
  it("maps structured start and archive outcomes to safe Japanese messages", () => {
    expect(prospectImportStartOutcomeError("started")).toBeNull();
    expect(prospectImportStartOutcomeError("list_unavailable")).toBe(
      PROSPECT_IMPORT_LIST_UNAVAILABLE_MESSAGE,
    );
    expect(prospectListArchiveOutcomeError("archived")).toBeNull();
    expect(prospectListArchiveOutcomeError("import_in_progress")).toBe(
      PROSPECT_LIST_IMPORT_IN_PROGRESS_MESSAGE,
    );
  });

  it("builds the atomic row payload with the existing normalizer and hash", () => {
    const staged: ProspectStagedRow = {
      companyName: "株式会社テスト",
      websiteUrl: "https://www.example.test/path",
      domain: null,
      mainPhone: "03-1234-5678",
      postalCode: "100-0001",
      prefecture: "東京都",
      city: "千代田区",
      address: "千代田1-1",
      industry: "IT",
      employeeRange: "10-49",
      contactName: " 山田 太郎 ",
      contactDepartment: "営業",
      contactTitle: null,
      contactEmail: " Sales@Example.test ",
      contactPhone: "090-1111-2222",
      externalRecordId: "EXT-1",
      notes: "展示会",
      sourceAttributes: { ブース: "A-1" },
    };
    const expected = stagedToNormalized(staged);
    const payload = buildAtomicProspectImportRowPayload({
      rowId: "00000000-0000-0000-0000-000000000001",
      rowNumber: 2,
      staged,
      formalMatch: {
        pageId: "notion-page",
        externalId: "ORG-1",
        displayName: "株式会社テスト",
        confidence: "high",
        reason: "domain",
      },
    });

    expect(payload.core).toEqual(expected.core);
    expect(payload.sourceRowHash).toBe(expected.sourceRowHash);
    expect(payload.sourceAttributes).toEqual(expected.sourceAttributes);
    expect(payload.contact.normalizedEmail).toBe("sales@example.test");
    expect(payload.contact.normalizedName).toBe("山田 太郎");
    expect(payload.formalMatch).toEqual({
      pageId: "notion-page",
      externalId: "ORG-1",
      confidence: "high",
      reason: "domain",
    });
  });

  it("does not use the old multi-transaction upsert/enqueue path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/import.ts"),
      "utf8",
    );
    expect(source).toContain('"process_prospect_import_chunk_atomic"');
    expect(source).not.toContain("upsertProspectFromImport({");
    expect(source).not.toContain("await enqueueJob({");
    const formalLookup = source.slice(
      source.indexOf("const formalMatches = await findFormalOrganizationMatches"),
      source.indexOf("prepared.push", source.indexOf("const formalMatches")),
    );
    expect(formalLookup).toContain("normalizedDomain");
    expect(formalLookup).toContain("normalizedPhone");
    expect(formalLookup).not.toContain("contactEmails");
    expect(formalLookup).not.toContain("companyName");
  });

  it("never remaps or replaces staging after an import has started", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/import.ts"),
      "utf8",
    );
    expect(source).toContain('.in("status", ["uploaded", "mapped"])');
    expect(source).toContain('.eq("status", "mapped")');
    expect(source).toContain('.update({ status: "validating" })');
    const claim = source.indexOf('.update({ status: "validating" })');
    const replace = source.indexOf('.from("prospect_import_rows")', claim);
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(claim).toBeLessThan(replace);
    expect(source.indexOf("existingStartResult(job)")).toBeLessThan(
      source.indexOf("await prepareProspectImport"),
    );
  });

  it("does not expose raw expected-RPC errors through Server Actions", () => {
    const importSource = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/import.ts"),
      "utf8",
    );
    const listSource = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/lists.ts"),
      "utf8",
    );
    const archiveStart = listSource.indexOf(
      "export async function archiveProspectList",
    );
    const archiveSource = listSource.slice(
      archiveStart,
      listSource.indexOf("export async function listProspectLists", archiveStart),
    );
    expect(importSource).not.toContain("startError.message");
    expect(archiveSource).not.toContain("throw new Error(error.message);");
  });

  it("finalizes an exhausted queue attempt and keeps worker errors operator-safe", () => {
    const handlerSource = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/jobs/handlers/prospect-csv-import.ts",
      ),
      "utf8",
    );
    expect(handlerSource).toContain("job.attempts >= job.max_attempts");
    expect(handlerSource).toContain("await failProspectImportJobIfCurrent({");
    expect(handlerSource).toContain(
      "PROSPECT_IMPORT_ATOMIC_PROCESSING_FAILED_MESSAGE",
    );
  });
});

describe("prospect import/archive help", () => {
  it("explains the archive restriction in article, FAQ and manual", () => {
    const article = getHelpArticle("import-prospect-csv");
    expect((article?.tips ?? []).join(" ")).toContain(
      "完了または失敗するまで営業リストをアーカイブできません",
    );
    expect(
      listHelpFaqs(true).some(
        (faq) => faq.id === "faq-archive-during-prospect-import",
      ),
    ).toBe(true);
    const manual = readFileSync(
      resolve(process.cwd(), "docs/user-guide/manual.md"),
      "utf8",
    );
    expect(manual).toContain(
      "完了または失敗するまで対象の営業リストをアーカイブできません",
    );
  });
});

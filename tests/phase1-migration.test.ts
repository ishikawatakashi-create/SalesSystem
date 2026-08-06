import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260806120000_phase1_foundation.sql",
  ),
  "utf8",
);

describe("Phase 1基盤マイグレーション契約", () => {
  it("必要な拡張・enumを定義する", () => {
    expect(migration).toContain("create extension if not exists pgcrypto");
    expect(migration).toContain("create extension if not exists pg_trgm");
    expect(migration).toContain("create type public.sync_status");
    expect(migration).toContain("create type public.job_status");
    expect(migration).toContain("create type public.write_op_status");
    expect(migration).toContain("create type public.import_row_status");
    expect(migration).not.toMatch(/create type public\.app_role/);
  });

  it("必須テーブルを定義する", () => {
    const tables = [
      "customer_index",
      "customer_relations",
      "contact_index",
      "deal_index",
      "activity_index",
      "contract_index",
      "complaint_index",
      "action_index",
      "masters_cache",
      "write_operations",
      "audit_logs",
      "jobs",
      "job_items",
      "sync_errors",
      "webhook_events",
      "import_jobs",
      "import_rows",
      "saved_searches",
      "recent_views",
      "system_settings",
      "notion_rate_limiter",
    ];
    for (const table of tables) {
      expect(migration).toContain(`create table if not exists public.${table}`);
    }
  });

  it("必須RPCをSECURITY DEFINER + search_path=''で定義する", () => {
    const rpcs = [
      "claim_next_job",
      "heartbeat_job",
      "complete_job",
      "fail_job",
      "ingest_webhook_event",
      "reserve_notion_slot",
      "report_notion_rate_limited",
    ];
    for (const rpc of rpcs) {
      expect(migration).toContain(`function public.${rpc}`);
    }
    expect(migration).toMatch(
      /claim_next_job[\s\S]*security definer set search_path = ''/,
    );
    expect(migration).toContain("current_app_role");
  });

  it("システムRPCをpublic/anon/authenticatedからREVOKEしservice_roleへGRANTする", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.claim_next_job\(text, int\) from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant\s+execute on function public\.claim_next_job\(text, int\) to service_role;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.reserve_notion_slot\(text\) from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.current_app_role\(\) from public, anon;/,
    );
    expect(migration).toMatch(
      /grant\s+execute on function public\.current_app_role\(\) to authenticated, service_role;/,
    );
  });

  it("heartbeat/complete/failはlocked_by一致かつlease_expires_at > now()", () => {
    expect(migration).toContain("and locked_by = p_worker_id");
    expect(migration).toContain("and lease_expires_at > pg_catalog.now()");
    expect(migration).toContain("for update skip locked");
  });

  it("audit_logsのUPDATE/DELETE禁止トリガーを定義する", () => {
    expect(migration).toContain("forbid_audit_mutation");
    expect(migration).toContain("audit_logs_no_update");
    expect(migration).toContain("audit_logs_no_delete");
    expect(migration).toContain("audit_logs is append-only");
    expect(migration).toContain(
      "revoke update, delete on public.audit_logs from authenticated, anon;",
    );
  });

  it("主要RLSポリシーを定義する", () => {
    expect(migration).toContain("audit_logs_select");
    expect(migration).toContain("jobs_select");
    expect(migration).toContain("saved_searches_insert");
    expect(migration).toContain("recent_views_select");
    expect(migration).toContain("system_settings_select");
    expect(migration).toContain("notion_rate_limiter_select");
  });
});

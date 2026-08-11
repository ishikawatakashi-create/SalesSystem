import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import { saveCallAttempt } from "@/lib/prospects/call-attempts";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811010000_atomic_prospect_call_result.sql",
  ),
  "utf8",
);
const saveSource = readFileSync(
  resolve(process.cwd(), "src/lib/prospects/call-attempts.ts"),
  "utf8",
).split("export async function listCallAttempts")[0];

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const PROSPECT_ID = "33333333-3333-4333-8333-333333333333";
const CONTACT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

describe("saveCallAttempt RPC boundary", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("canonicalizes the full payload and performs exactly one RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          attempt_id: "66666666-6666-4666-8666-666666666666",
          duplicated: false,
          stage: "qualified",
          promote_cta_strong: true,
        },
      ],
      error: null,
    });

    await expect(
      saveCallAttempt({
        requestId: ` ${REQUEST_ID} `,
        membershipId: MEMBERSHIP_ID,
        prospectId: PROSPECT_ID,
        contactId: CONTACT_ID,
        performedBy: USER_ID,
        actorName: "Caller supplied name is not trusted by the RPC",
        result: "interested",
        note: "  follow up  ",
        startedAt: "2026-08-11T01:00:00.000Z",
        nextContactAt: "2026-08-12T01:00:00.000Z",
        clearNextContact: false,
        phoneUsed: " ０３−１２３４−５６７８ ",
      }),
    ).resolves.toEqual({
      attemptId: "66666666-6666-4666-8666-666666666666",
      duplicated: false,
      stage: "qualified",
      promoteCtaStrong: true,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_prospect_call_attempt", {
      p_request_id: REQUEST_ID,
      p_membership_id: MEMBERSHIP_ID,
      p_prospect_id: PROSPECT_ID,
      p_contact_id: CONTACT_ID,
      p_performed_by: USER_ID,
      p_result: "interested",
      p_note: "follow up",
      p_started_at: "2026-08-11T01:00:00.000Z",
      p_next_contact_at: "2026-08-12T01:00:00.000Z",
      p_clear_next_contact: false,
      p_phone_used: "０３−１２３４−５６７８",
      p_phone_normalized: "0312345678",
    });
  });

  it.each([
    { nextContactAt: null, clearNextContact: false },
    { nextContactAt: "2026-08-12T01:00:00.000Z", clearNextContact: true },
  ])(
    "rejects callback without a retained next contact before RPC: %o",
    async ({ nextContactAt, clearNextContact }) => {
      await expect(
        saveCallAttempt({
          requestId: REQUEST_ID,
          membershipId: MEMBERSHIP_ID,
          prospectId: PROSPECT_ID,
          performedBy: USER_ID,
          actorName: "Test User",
          result: "callback_requested",
          nextContactAt,
          clearNextContact,
        }),
      ).rejects.toThrow("next_contact_required");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("surfaces an RPC failure and fails closed on an empty RPC result", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "call_claim_required" },
    });
    await expect(
      saveCallAttempt({
        requestId: REQUEST_ID,
        membershipId: MEMBERSHIP_ID,
        prospectId: PROSPECT_ID,
        performedBy: USER_ID,
        actorName: "Test User",
        result: "no_answer",
      }),
    ).rejects.toThrow("call_claim_required");

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      saveCallAttempt({
        requestId: REQUEST_ID,
        membershipId: MEMBERSHIP_ID,
        prospectId: PROSPECT_ID,
        performedBy: USER_ID,
        actorName: "Test User",
        result: "no_answer",
      }),
    ).rejects.toThrow("call_attempt_save_failed");
  });
});

describe("atomic prospect call migration", () => {
  it("keeps the application save path to one transactional RPC", () => {
    expect(saveSource).toContain(
      'admin.rpc("save_prospect_call_attempt"',
    );
    expect(saveSource).not.toContain(".insert(");
    expect(saveSource).not.toContain(".update(");
    expect(saveSource).not.toContain("writeProspectAudit");
    expect(saveSource).not.toContain("setProspectDoNotContact");
    expect(migration).toContain("insert into public.prospect_call_attempts");
    expect(migration).toContain("update public.prospect_list_memberships");
    expect(migration).toContain("update public.prospects prospect");
    expect(migration).toContain("insert into public.audit_logs");
  });

  it("serializes requests, returns immutable retry snapshots, and conflicts on any canonical payload change", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("input_snapshot jsonb");
    expect(migration).toContain("result_snapshot jsonb");
    for (const field of [
      "prospect_id",
      "membership_id",
      "contact_id",
      "performed_by",
      "result",
      "note",
      "started_at",
      "next_contact_at",
      "clear_next_contact",
      "phone_used",
      "phone_normalized",
      "source",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toContain(
      "v_existing_input_snapshot is distinct from v_input_snapshot",
    );
    expect(migration).toContain("message = 'request_id_conflict'");
    expect(migration.indexOf("-- Exact retry")).toBeLessThan(
      migration.indexOf("-- 新規保存ではActor"),
    );
    expect(migration).toContain("v_existing.result_snapshot ->> 'stage'");
  });

  it("revalidates actor and locks actor then list, prospect, membership in a fixed order", () => {
    const actorLock = migration.indexOf("from public.app_users actor");
    const listLock = migration.indexOf("select prospect_list.*");
    const prospectLock = migration.indexOf("select prospect.*");
    const membershipLock = migration.indexOf("select membership.*");
    expect(actorLock).toBeGreaterThan(-1);
    expect(actorLock).toBeLessThan(listLock);
    expect(listLock).toBeLessThan(prospectLock);
    expect(prospectLock).toBeLessThan(membershipLock);
    expect(migration).toContain("for share;");
    const listLockBlock = migration.slice(listLock, prospectLock);
    expect(listLockBlock).toContain("for share;");
    expect(listLockBlock).not.toContain("for update;");
    expect(migration).toContain("v_actor.is_active");
    expect(migration).toContain(
      "v_actor.provisioning_status not in ('profile_created', 'completed')",
    );
    expect(migration).toContain("v_actor.role not in ('admin', 'a', 'b')");
  });

  it("requires a live owned claim and rejects archived list state before any write", () => {
    expect(migration).toContain(
      "v_membership.claimed_by is distinct from p_performed_by",
    );
    expect(migration).toContain("v_membership.claim_expires_at > v_now");
    expect(migration).toContain("v_membership.claim_expires_at <= v_now");
    expect(migration).toContain("message = 'call_claim_required'");
    expect(migration).toContain("message = 'call_claim_conflict'");
    expect(migration).toContain(
      "v_list.archived_at is not null or v_list.status = 'archived'",
    );
    expect(migration.indexOf("message = 'prospect_list_archived'")).toBeLessThan(
      migration.indexOf("insert into public.prospect_call_attempts"),
    );
  });

  it("enforces callback and all result side effects inside the transaction", () => {
    expect(migration).toContain(
      "p_next_contact_at is null or v_clear_next_contact",
    );
    expect(migration).toContain("message = 'next_contact_required'");
    expect(migration).toContain("then 'working'");
    expect(migration).toContain("then 'qualified'");
    expect(migration).toContain("then 'disqualified'");
    expect(migration).toContain("p_result = 'do_not_contact'");
    expect(migration).toContain("p_result = 'wrong_number'");
    expect(migration).toContain(
      "p_result in ('interested', 'appointment')",
    );
  });

  it("records request-linked audits with explicit before/after state", () => {
    expect(migration).toContain("'prospect.dnc_set'");
    expect(migration).toContain("'prospect.call_attempt.create'");
    for (const field of [
      "prospect_id",
      "prospect_list_id",
      "membership_id",
      "stage_before",
      "stage_after",
      "next_contact_at_before",
      "next_contact_at_after",
      "call_count_before",
      "call_count_after",
      "claimed_by_before",
      "claimed_by_after",
      "do_not_contact_before",
      "do_not_contact_after",
      "phone_invalid_before",
      "phone_invalid_after",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toMatch(
      /'prospect\.dnc_set'[\s\S]*?'app',\s*p_request_id,\s*null/,
    );
  });

  it("removes authenticated execution from every call mutation RPC", () => {
    for (const functionName of [
      "save_prospect_call_attempt",
      "claim_next_prospect_call",
      "release_prospect_call_claim",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
        ),
      );
    }
  });

  it("excludes archived lists from the claim-next candidate query", () => {
    expect(migration).toContain("join public.prospect_lists prospect_list");
    expect(migration).toContain("prospect_list.archived_at is null");
    expect(migration).toContain("prospect_list.status <> 'archived'");
  });
});

/**
 * Phase 1 リモートDB結合テスト。
 * RUN_REMOTE_DB_TESTS=1 かつ .env.local のSupabase鍵がある場合のみ実行。
 * 既存管理者・認証スパイクユーザーは変更しない。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, JobRow } from "@/types/database";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const RUN = process.env.RUN_REMOTE_DB_TESTS === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;

const describeRemote = RUN && url && publishable && secret ? describe : describe.skip;

const TEST_PREFIX = "test_phase1_it";
const TEST_VIEWER_EMAIL = "test_phase1_it.viewer@example.invalid";
const TEST_A_EMAIL = "test_phase1_it.role_a@example.invalid";
const TEST_UNINVITED_EMAIL = "test_phase1_it.uninvited@example.invalid";
const TEST_PASSWORD = "TestPhase1It!pass-9f3a";
const CUSTOMER_PAGE_ID = `${TEST_PREFIX}_customer_page`;

type AnyClient = SupabaseClient<Database>;

describeRemote("Phase 1 リモートDB結合", { timeout: 30_000 }, () => {
  let admin: AnyClient;
  let anon: AnyClient;
  let viewerUserId: string | null = null;
  let roleAUserId: string | null = null;
  const invitationIds: string[] = [];
  const jobIds: string[] = [];
  let auditLogId: string | null = null;
  let adminSnapshot: Array<{
    id: string;
    email: string;
    role: string;
    is_active: boolean;
    provisioning_status: string;
  }> = [];
  let rateLimiterBefore: {
    next_slot_at: string;
    blocked_until: string | null;
    min_interval_ms: number;
  } | null = null;

  beforeAll(async () => {
    admin = createClient<Database>(url!, secret!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient<Database>(url!, publishable!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: admins, error } = await admin
      .from("app_users")
      .select("id,email,role,is_active,provisioning_status")
      .eq("role", "admin")
      .order("created_at");
    if (error) throw error;
    adminSnapshot = admins ?? [];

    const { data: rl } = await admin
      .from("notion_rate_limiter")
      .select("next_slot_at,blocked_until,min_interval_ms")
      .eq("id", 1)
      .single();
    rateLimiterBefore = rl;

    await cleanupLeftovers(admin);

    // 前回失敗で残ったテストAuthユーザーを掃除(管理者は対象外)
    const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of listed?.users ?? []) {
      if (user.email?.toLowerCase().startsWith("test_phase1_it.")) {
        await admin.from("app_users").delete().eq("id", user.id);
        await admin.auth.admin.deleteUser(user.id);
      }
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await cleanupTestArtifacts(admin, {
      jobIds,
      viewerUserId,
      roleAUserId,
      invitationIds,
      customerPageId: CUSTOMER_PAGE_ID,
    });
    // rate limiter: blocked_until をクリア(次枠は壊さないため最小限)
    await admin
      .from("notion_rate_limiter")
      .update({ blocked_until: null })
      .eq("id", 1);
  }, 60_000);

  it("ジョブ: 同時claimは1ワーカーのみ取得", async () => {
    const job = await insertQueuedJob(admin, `${TEST_PREFIX}_claim_concurrent`);
    jobIds.push(job.id);

    const restore = await pauseOtherQueuedJobs(admin, job.id);
    try {
      const [a, b] = await Promise.all([
        admin.rpc("claim_next_job", {
          p_worker_id: `${TEST_PREFIX}_w1`,
          p_lease_seconds: 300,
        }),
        admin.rpc("claim_next_job", {
          p_worker_id: `${TEST_PREFIX}_w2`,
          p_lease_seconds: 300,
        }),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();

      const claimedA = (a.data ?? []) as JobRow[];
      const claimedB = (b.data ?? []) as JobRow[];
      const hits = [...claimedA, ...claimedB].filter((j) => j.id === job.id);
      if (hits.length !== 1) {
        const { data: rowState } = await admin
          .from("jobs")
          .select("status,locked_by,attempts,next_run_at,lease_expires_at")
          .eq("id", job.id)
          .single();
        throw new Error(
          `同時claim検証失敗: hits=${hits.length} A=${JSON.stringify(claimedA.map((j) => j.id))} B=${JSON.stringify(claimedB.map((j) => j.id))} row=${JSON.stringify(rowState)}`,
        );
      }
      expect(hits).toHaveLength(1);

      const { data: row } = await admin
        .from("jobs")
        .select("locked_by,status,attempts")
        .eq("id", job.id)
        .single();
      expect(row?.status).toBe("running");
      expect(row?.attempts).toBe(1);
      expect([`${TEST_PREFIX}_w1`, `${TEST_PREFIX}_w2`]).toContain(row?.locked_by);
    } finally {
      await restore();
    }
  });

  it("ジョブ: リース内heartbeatは所有者のみ、期限後は拒否、回収可能", async () => {
    const job = await insertQueuedJob(admin, `${TEST_PREFIX}_lease`);
    jobIds.push(job.id);
    const restore = await pauseOtherQueuedJobs(admin, job.id);
    try {
      const { data: claimed } = await admin.rpc("claim_next_job", {
        p_worker_id: `${TEST_PREFIX}_owner`,
        p_lease_seconds: 120,
      });
      const owned = ((claimed ?? []) as JobRow[]).find((j) => j.id === job.id);
      expect(owned).toBeTruthy();

      const ok = await admin.rpc("heartbeat_job", {
        p_job_id: job.id,
        p_worker_id: `${TEST_PREFIX}_owner`,
        p_lease_seconds: 120,
      });
      expect(ok.error).toBeNull();
      expect(ok.data).toBe(true);

      const other = await admin.rpc("heartbeat_job", {
        p_job_id: job.id,
        p_worker_id: `${TEST_PREFIX}_other`,
        p_lease_seconds: 120,
      });
      expect(other.data).toBe(false);

      const past = new Date(Date.now() - 60_000).toISOString();
      const { error: expireError } = await admin
        .from("jobs")
        .update({ lease_expires_at: past })
        .eq("id", job.id);
      expect(expireError).toBeNull();

      const lateHb = await admin.rpc("heartbeat_job", {
        p_job_id: job.id,
        p_worker_id: `${TEST_PREFIX}_owner`,
        p_lease_seconds: 120,
      });
      expect(lateHb.data).toBe(false);

      const lateComplete = await admin.rpc("complete_job", {
        p_job_id: job.id,
        p_worker_id: `${TEST_PREFIX}_owner`,
        p_result: { ok: true },
      });
      expect(lateComplete.data).toBe(false);

      const lateFail = await admin.rpc("fail_job", {
        p_job_id: job.id,
        p_worker_id: `${TEST_PREFIX}_owner`,
        p_error_message: "late",
        p_backoff_seconds: 30,
      });
      expect(lateFail.data).toBe(false);

      const recovered = await admin.rpc("claim_next_job", {
        p_worker_id: `${TEST_PREFIX}_rescuer`,
        p_lease_seconds: 120,
      });
      const rec = ((recovered.data ?? []) as JobRow[]).find((j) => j.id === job.id);
      expect(rec?.locked_by).toBe(`${TEST_PREFIX}_rescuer`);
      expect(rec?.attempts).toBe(2);
    } finally {
      await restore();
    }
  });

  it("ジョブ: attempts上限でfailed、fail後はバックオフ", async () => {
    const backoffJob = await insertQueuedJob(admin, `${TEST_PREFIX}_backoff`);
    jobIds.push(backoffJob.id);
    const restore = await pauseOtherQueuedJobs(admin, backoffJob.id);
    try {
      const { data: claimed } = await admin.rpc("claim_next_job", {
        p_worker_id: `${TEST_PREFIX}_failer`,
        p_lease_seconds: 180,
      });
      expect(
        ((claimed ?? []) as JobRow[]).some((j) => j.id === backoffJob.id),
      ).toBe(true);

      const failed = await admin.rpc("fail_job", {
        p_job_id: backoffJob.id,
        p_worker_id: `${TEST_PREFIX}_failer`,
        p_error_message: `${TEST_PREFIX}_temporary`,
        p_backoff_seconds: 3600,
      });
      expect(failed.error).toBeNull();
      expect(failed.data).toBe(true);

      const { data: afterFail } = await admin
        .from("jobs")
        .select("status,next_run_at,locked_by,error_message")
        .eq("id", backoffJob.id)
        .single();
      expect(afterFail?.status).toBe("queued");
      expect(afterFail?.locked_by).toBeNull();
      expect(afterFail?.error_message).toContain(`${TEST_PREFIX}_temporary`);
      expect(new Date(afterFail!.next_run_at).getTime()).toBeGreaterThan(
        Date.now() + 3_000_000,
      );
    } finally {
      await restore();
    }

    const maxJob = await insertQueuedJob(admin, `${TEST_PREFIX}_max_attempts`);
    jobIds.push(maxJob.id);
    const past = new Date(Date.now() - 30_000).toISOString();
    await admin
      .from("jobs")
      .update({
        status: "running",
        locked_by: `${TEST_PREFIX}_dead`,
        lease_expires_at: past,
        attempts: 5,
        max_attempts: 5,
        started_at: past,
      })
      .eq("id", maxJob.id);

    // 他候補を退避(対象はrunningリース切れのまま回収/failed判定させる)
    const restore2 = await pauseOtherQueuedJobs(admin, maxJob.id, {
      allowStatuses: ["running"],
    });
    try {
      const claimMax = await admin.rpc("claim_next_job", {
        p_worker_id: `${TEST_PREFIX}_claimer`,
        p_lease_seconds: 60,
      });
      const claimedMax = ((claimMax.data ?? []) as JobRow[]).find(
        (j) => j.id === maxJob.id,
      );
      expect(claimedMax).toBeUndefined();

      const { data: failedRow } = await admin
        .from("jobs")
        .select("status,error_message")
        .eq("id", maxJob.id)
        .single();
      expect(failedRow?.status).toBe("failed");
      expect(failedRow?.error_message ?? "").toMatch(/max_attempts|lease expired/i);
    } finally {
      await restore2();
    }
  });

  it("監査ログ: INSERT成功、Secret keyでもUPDATE/DELETE拒否", async () => {
    const { data, error } = await admin
      .from("audit_logs")
      .insert({
        action: `${TEST_PREFIX}_insert`,
        entity_type: "integration_test",
        notion_page_id: null,
        actor_id: null,
        actor_name: TEST_PREFIX,
        changed_fields: {
          integration_test: true,
          suite: TEST_PREFIX,
        },
        operation_source: "integration_test",
        request_id: null,
        batch_id: TEST_PREFIX,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    auditLogId = data?.id ?? null;
    expect(auditLogId).toBeTruthy();

    const { error: updateError } = await admin
      .from("audit_logs")
      .update({ action: `${TEST_PREFIX}_tamper` })
      .eq("id", auditLogId!);
    expect(updateError).toBeTruthy();
    expect(updateError?.message ?? "").toMatch(/append-only|audit_logs/i);

    const { error: deleteError } = await admin
      .from("audit_logs")
      .delete()
      .eq("id", auditLogId!);
    expect(deleteError).toBeTruthy();
    expect(deleteError?.message ?? "").toMatch(/append-only|audit_logs/i);

    const { data: stillThere } = await admin
      .from("audit_logs")
      .select("id,action,changed_fields")
      .eq("id", auditLogId!)
      .maybeSingle();
    expect(stillThere?.action).toBe(`${TEST_PREFIX}_insert`);
  });

  it("RPC権限: anon/authenticatedはシステムRPC不可、current_app_roleはauthenticated可", async () => {
    const anonClaim = await anon.rpc("claim_next_job", {
      p_worker_id: `${TEST_PREFIX}_anon`,
      p_lease_seconds: 30,
    });
    expect(anonClaim.error).toBeTruthy();

    const anonReserve = await anon.rpc("reserve_notion_slot", {
      p_priority: "bulk",
    });
    expect(anonReserve.error).toBeTruthy();

    // authenticated JWT (viewer) を用意
    const viewer = await ensureTestUser(admin, {
      email: TEST_VIEWER_EMAIL,
      role: "viewer",
      password: TEST_PASSWORD,
    });
    viewerUserId = viewer.userId;
    invitationIds.push(viewer.invitationId);

    const viewerClient = createClient<Database>(url!, publishable!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signError } = await viewerClient.auth.signInWithPassword({
      email: TEST_VIEWER_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(signError).toBeNull();

    const authClaim = await viewerClient.rpc("claim_next_job", {
      p_worker_id: `${TEST_PREFIX}_auth`,
      p_lease_seconds: 30,
    });
    expect(authClaim.error).toBeTruthy();

    const role = await viewerClient.rpc("current_app_role");
    expect(role.error).toBeNull();
    expect(role.data).toBe("viewer");

    const backendClaim = await admin.rpc("claim_next_job", {
      p_worker_id: `${TEST_PREFIX}_backend_noop`,
      p_lease_seconds: 30,
    });
    // 対象ジョブが無くてもEXECUTE自体は成功(空配列)
    expect(backendClaim.error).toBeNull();
  });

  it("RLS: 未認証不可 / 有効ユーザー閲覧可 / viewer書込不可 / Aのみ監査閲覧", async () => {
    await admin.from("customer_index").upsert({
      notion_page_id: CUSTOMER_PAGE_ID,
      display_name: `${TEST_PREFIX} customer`,
      search_text: TEST_PREFIX,
      sync_status: "synced",
    });

    const anonSelect = await anon
      .from("customer_index")
      .select("notion_page_id")
      .eq("notion_page_id", CUSTOMER_PAGE_ID);
    expect((anonSelect.data ?? []).length).toBe(0);

    const viewerClient = createClient<Database>(url!, publishable!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await viewerClient.auth.signInWithPassword({
      email: TEST_VIEWER_EMAIL,
      password: TEST_PASSWORD,
    });

    const viewerSelect = await viewerClient
      .from("customer_index")
      .select("notion_page_id,display_name")
      .eq("notion_page_id", CUSTOMER_PAGE_ID)
      .maybeSingle();
    expect(viewerSelect.error).toBeNull();
    expect(viewerSelect.data?.notion_page_id).toBe(CUSTOMER_PAGE_ID);

    const viewerWrite = await viewerClient.from("customer_index").insert({
      notion_page_id: `${CUSTOMER_PAGE_ID}_viewer_write`,
      display_name: "should fail",
      search_text: "x",
    });
    expect(viewerWrite.error).toBeTruthy();

    const viewerAudit = await viewerClient
      .from("audit_logs")
      .select("id")
      .eq("id", auditLogId!)
      .maybeSingle();
    expect(viewerAudit.data).toBeNull();

    const roleA = await ensureTestUser(admin, {
      email: TEST_A_EMAIL,
      role: "a",
      password: TEST_PASSWORD,
    });
    roleAUserId = roleA.userId;
    invitationIds.push(roleA.invitationId);

    const aClient = createClient<Database>(url!, publishable!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await aClient.auth.signInWithPassword({
      email: TEST_A_EMAIL,
      password: TEST_PASSWORD,
    });
    const aAudit = await aClient
      .from("audit_logs")
      .select("id,action")
      .eq("id", auditLogId!)
      .maybeSingle();
    expect(aAudit.error).toBeNull();
    expect(aAudit.data?.id).toBe(auditLogId);
  });

  it("レートリミッター: 連続予約単調増加・blocked_until・停止前予約不可", async () => {
    const s1 = await admin.rpc("reserve_notion_slot", { p_priority: "interactive" });
    const s2 = await admin.rpc("reserve_notion_slot", { p_priority: "bulk" });
    const s3 = await admin.rpc("reserve_notion_slot", { p_priority: "bulk" });
    expect(s1.error).toBeNull();
    expect(s2.error).toBeNull();
    expect(s3.error).toBeNull();
    const t1 = new Date(String(s1.data)).getTime();
    const t2 = new Date(String(s2.data)).getTime();
    const t3 = new Date(String(s3.data)).getTime();
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);

    const beforeBlock = Date.now();
    const report = await admin.rpc("report_notion_rate_limited", {
      p_retry_after_seconds: 120,
    });
    expect(report.error).toBeNull();

    const { data: state } = await admin
      .from("notion_rate_limiter")
      .select("blocked_until,next_slot_at")
      .eq("id", 1)
      .single();
    expect(state?.blocked_until).toBeTruthy();
    const blockedUntil = new Date(state!.blocked_until!).getTime();
    expect(blockedUntil).toBeGreaterThanOrEqual(beforeBlock + 100_000);

    const after = await admin.rpc("reserve_notion_slot", { p_priority: "bulk" });
    expect(after.error).toBeNull();
    const reserved = new Date(String(after.data)).getTime();
    expect(reserved).toBeGreaterThanOrEqual(blockedUntil);

    // 復元用に参照(レポートのみ)。実変更の戻しはafterAll
    expect(rateLimiterBefore).toBeTruthy();
  });

  it("認証回帰: 既存admin不変 / Hookが未招待を拒否", async () => {
    const { data: admins } = await admin
      .from("app_users")
      .select("id,email,role,is_active,provisioning_status")
      .eq("role", "admin")
      .order("created_at");
    const current = admins ?? [];
    for (const snap of adminSnapshot) {
      const found = current.find((a) => a.id === snap.id);
      expect(found).toBeTruthy();
      expect(found?.email).toBe(snap.email);
      expect(found?.is_active).toBe(snap.is_active);
      expect(found?.provisioning_status).toBe(snap.provisioning_status);
    }

    // Before User Created Hookは公開signUp経路で強制される。
    // Auth Admin APIのcreateUserはHookを迂回するため、回帰確認はsignUpで行う。
    const signup = await anon.auth.signUp({
      email: TEST_UNINVITED_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(signup.error).toBeTruthy();
    expect(signup.data.user).toBeNull();
    expect(signup.error?.status).toBe(403);

    const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
    const leaked = (listed?.users ?? []).find(
      (u) => u.email?.toLowerCase() === TEST_UNINVITED_EMAIL.toLowerCase(),
    );
    expect(leaked).toBeUndefined();
  });
});

async function insertQueuedJob(admin: AnyClient, key: string): Promise<JobRow> {
  const { data, error } = await admin
    .from("jobs")
    .insert({
      kind: `${TEST_PREFIX}_noop`,
      priority: 1,
      status: "queued",
      payload: { suite: TEST_PREFIX },
      idempotency_key: key,
      next_run_at: new Date(Date.now() - 60_000).toISOString(),
      max_attempts: 5,
      attempts: 0,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("job insert failed");
  return data as unknown as JobRow;
}

async function pauseOtherQueuedJobs(
  admin: AnyClient,
  keepJobId: string,
  options?: { allowStatuses?: Array<"queued" | "running"> },
): Promise<() => Promise<void>> {
  const allow = options?.allowStatuses ?? ["queued"];
  const nowIso = new Date().toISOString();
  const far = new Date(Date.now() + 86_400_000).toISOString();

  const { data: queued } = await admin
    .from("jobs")
    .select("id,next_run_at,status,lease_expires_at")
    .eq("status", "queued")
    .neq("id", keepJobId);

  const { data: expiredRunning } = await admin
    .from("jobs")
    .select("id,next_run_at,status,lease_expires_at")
    .eq("status", "running")
    .lt("lease_expires_at", nowIso)
    .neq("id", keepJobId);

  const queuedSnap = queued ?? [];
  const runningSnap = expiredRunning ?? [];

  if (queuedSnap.length) {
    await admin
      .from("jobs")
      .update({ next_run_at: far })
      .in(
        "id",
        queuedSnap.map((j) => j.id),
      );
  }
  if (runningSnap.length) {
    await admin
      .from("jobs")
      .update({ lease_expires_at: far })
      .in(
        "id",
        runningSnap.map((j) => j.id),
      );
  }

  const { data: target } = await admin
    .from("jobs")
    .select("id,status,next_run_at,attempts,max_attempts")
    .eq("id", keepJobId)
    .single();
  if (!target || !allow.includes(target.status as "queued" | "running")) {
    throw new Error(
      `isolate失敗: 対象ジョブが想定状態ではない (${target?.status ?? "missing"})`,
    );
  }
  if (
    target.status === "queued" &&
    new Date(target.next_run_at).getTime() > Date.now() - 1_000
  ) {
    await admin
      .from("jobs")
      .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", keepJobId);
  }

  return async () => {
    for (const row of queuedSnap) {
      await admin
        .from("jobs")
        .update({ next_run_at: row.next_run_at })
        .eq("id", row.id)
        .eq("status", "queued");
    }
    for (const row of runningSnap) {
      await admin
        .from("jobs")
        .update({ lease_expires_at: row.lease_expires_at })
        .eq("id", row.id)
        .eq("status", "running");
    }
  };
}

async function ensureTestUser(
  admin: AnyClient,
  input: { email: string; role: "viewer" | "a" | "admin"; password: string },
): Promise<{ userId: string; invitationId: string }> {
  const normalized = input.email.toLowerCase().trim();

  // 既存テストユーザーがいれば再利用
  const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = (existingUsers?.users ?? []).find(
    (u) => u.email?.toLowerCase() === normalized,
  );
  if (existing) {
    const { data: app } = await admin
      .from("app_users")
      .select("id")
      .eq("id", existing.id)
      .maybeSingle();
    if (!app) {
      await admin.rpc("accept_invitation_and_provision", {
        p_user_id: existing.id,
        p_email: input.email,
      });
    }
    const { data: inv } = await admin
      .from("user_invitations")
      .select("id")
      .eq("normalized_email", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { userId: existing.id, invitationId: inv?.id ?? "existing" };
  }

  // 期限切れpendingを掃除してから招待
  await admin
    .from("user_invitations")
    .update({ status: "expired", revoked_at: null })
    .eq("normalized_email", normalized)
    .eq("status", "pending");

  const { data: invitation, error: invError } = await admin
    .from("user_invitations")
    .insert({
      email: input.email,
      normalized_email: normalized,
      display_name: `${TEST_PREFIX} ${input.role}`,
      role: input.role,
      status: "pending",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (invError || !invitation) throw invError ?? new Error("invitation insert failed");

  const created = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("createUser failed");
  }

  const provisioned = await admin.rpc("accept_invitation_and_provision", {
    p_user_id: created.data.user.id,
    p_email: input.email,
  });
  if (provisioned.error) throw provisioned.error;

  return { userId: created.data.user.id, invitationId: invitation.id };
}

async function cleanupLeftovers(admin: AnyClient): Promise<void> {
  await admin.from("jobs").delete().like("idempotency_key", `${TEST_PREFIX}%`);
  await admin.from("customer_index").delete().eq("notion_page_id", CUSTOMER_PAGE_ID);
  await admin
    .from("customer_index")
    .delete()
    .eq("notion_page_id", `${CUSTOMER_PAGE_ID}_viewer_write`);
}

async function cleanupTestArtifacts(
  admin: AnyClient,
  ids: {
    jobIds: string[];
    viewerUserId: string | null;
    roleAUserId: string | null;
    invitationIds: string[];
    customerPageId: string;
  },
): Promise<void> {
  if (ids.jobIds.length) {
    await admin.from("jobs").delete().in("id", ids.jobIds);
  }
  await admin.from("jobs").delete().like("idempotency_key", `${TEST_PREFIX}%`);
  await admin.from("customer_index").delete().eq("notion_page_id", ids.customerPageId);
  await admin
    .from("customer_index")
    .delete()
    .eq("notion_page_id", `${ids.customerPageId}_viewer_write`);

  for (const userId of [ids.viewerUserId, ids.roleAUserId]) {
    if (!userId) continue;
    await admin
      .from("user_invitations")
      .update({ invited_by: null })
      .eq("invited_by", userId);
    await admin.from("app_users").update({ invitation_id: null }).eq("id", userId);
    await admin.from("app_users").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }

  const emails = [TEST_VIEWER_EMAIL, TEST_A_EMAIL, TEST_UNINVITED_EMAIL].map((e) =>
    e.toLowerCase(),
  );
  await admin.from("user_invitations").delete().in("normalized_email", emails);

  for (const id of ids.invitationIds) {
    if (id !== "existing") {
      await admin.from("user_invitations").delete().eq("id", id);
    }
  }
}

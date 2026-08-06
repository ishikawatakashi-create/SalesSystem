import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { JobKind, JobRow } from "@/lib/jobs/types";
import {
  JOB_LEASE_SECONDS,
} from "@/lib/jobs/config";

export async function enqueueJob(input: {
  kind: JobKind | string;
  payload?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string;
  createdBy?: string | null;
  nextRunAt?: string;
}): Promise<JobRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .insert({
      kind: input.kind,
      payload: input.payload ?? {},
      priority: input.priority ?? 100,
      idempotency_key: input.idempotencyKey ?? null,
      created_by: input.createdBy ?? null,
      next_run_at: input.nextRunAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    // 二重enqueueはidempotency_key衝突として既存を返す
    if (error.code === "23505" && input.idempotencyKey) {
      const { data: existing } = await admin
        .from("jobs")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing) return existing as unknown as JobRow;
    }
    throw new Error(`ジョブのenqueueに失敗しました: ${error.message}`);
  }
  return data as unknown as JobRow;
}

export async function claimNextJob(
  workerId: string,
  leaseSeconds: number = JOB_LEASE_SECONDS,
): Promise<JobRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_next_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`claim_next_jobに失敗しました: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as JobRow[];
  return rows[0] ?? null;
}

export async function heartbeatJob(
  jobId: string,
  workerId: string,
  leaseSeconds: number = JOB_LEASE_SECONDS,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("heartbeat_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`heartbeat_jobに失敗しました: ${error.message}`);
  }
  return Boolean(data);
}

export async function completeJob(
  jobId: string,
  workerId: string,
  result?: Record<string, unknown>,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_result: result ?? null,
  });
  if (error) {
    throw new Error(`complete_jobに失敗しました: ${error.message}`);
  }
  return Boolean(data);
}

export async function failJob(
  jobId: string,
  workerId: string,
  errorMessage: string,
  backoffSeconds: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error_message: errorMessage,
    p_backoff_seconds: backoffSeconds,
  });
  if (error) {
    throw new Error(`fail_jobに失敗しました: ${error.message}`);
  }
  return Boolean(data);
}

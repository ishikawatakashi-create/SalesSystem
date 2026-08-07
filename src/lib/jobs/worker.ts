import "server-only";

import { computeBackoffSeconds } from "@/lib/jobs/backoff";
import {
  JOB_HEARTBEAT_INTERVAL_SECONDS,
  JOB_LEASE_SECONDS,
} from "@/lib/jobs/config";
import { verifyCronSecret } from "@/lib/jobs/cron-secret";
import { getJobHandler } from "@/lib/jobs/handlers";
import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
} from "@/lib/jobs/queue";
import { ensureDailyMaintenanceJobs } from "@/lib/jobs/daily-maintenance";
import { detectStuckJobs } from "@/lib/jobs/stuck";
import type { JobRow } from "@/lib/jobs/types";
import { createWorkerId } from "@/lib/jobs/worker-id";

export { verifyCronSecret };

export type WorkerRunResult = {
  workerId: string;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  leaseLost: number;
  skippedUnknown: number;
  stuck: {
    overdueQueued: number;
    expiredRunning: number;
    total: number;
  };
  errors: string[];
};

const DEFAULT_MAX_JOBS_PER_RUN = 5;
const DEFAULT_MAX_RUNTIME_MS = 50_000;

/**
 * ジョブワーカー本体。
 * CRON_SECRET検証後に呼ばれる。claim→heartbeat→完了/失敗を繰り返す。
 */
export async function runJobWorker(options?: {
  maxJobs?: number;
  maxRuntimeMs?: number;
  leaseSeconds?: number;
  heartbeatIntervalSeconds?: number;
}): Promise<WorkerRunResult> {
  const workerId = createWorkerId();
  const maxJobs = options?.maxJobs ?? DEFAULT_MAX_JOBS_PER_RUN;
  const maxRuntimeMs = options?.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const leaseSeconds = options?.leaseSeconds ?? JOB_LEASE_SECONDS;
  const heartbeatIntervalSeconds =
    options?.heartbeatIntervalSeconds ?? JOB_HEARTBEAT_INTERVAL_SECONDS;
  const started = Date.now();

  const result: WorkerRunResult = {
    workerId,
    processed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    leaseLost: 0,
    skippedUnknown: 0,
    stuck: { overdueQueued: 0, expiredRunning: 0, total: 0 },
    errors: [],
  };

  try {
    result.stuck = await detectStuckJobs();
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "滞留ジョブ検知に失敗",
    );
  }

  try {
    await ensureDailyMaintenanceJobs();
  } catch (error) {
    result.errors.push(
      error instanceof Error
        ? error.message
        : "日次メンテナンスenqueueに失敗",
    );
  }

  while (result.processed < maxJobs && Date.now() - started < maxRuntimeMs) {
    const job = await claimNextJob(workerId, leaseSeconds);
    if (!job) break;

    result.processed += 1;
    await processClaimedJob(job, workerId, leaseSeconds, heartbeatIntervalSeconds, result);
  }

  return result;
}

async function processClaimedJob(
  job: JobRow,
  workerId: string,
  leaseSeconds: number,
  heartbeatIntervalSeconds: number,
  result: WorkerRunResult,
): Promise<void> {
  const handler = getJobHandler(job.kind);
  if (!handler) {
    const ok = await failJob(
      job.id,
      workerId,
      `未登録のジョブkind: ${job.kind}`,
      computeBackoffSeconds(job.attempts),
    );
    if (!ok) {
      result.leaseLost += 1;
      return;
    }
    result.skippedUnknown += 1;
    if (job.attempts >= job.max_attempts) {
      result.failed += 1;
    } else {
      result.retried += 1;
    }
    return;
  }

  let lastHeartbeat = Date.now();
  const heartbeat = async (): Promise<boolean> => {
    const ok = await heartbeatJob(job.id, workerId, leaseSeconds);
    if (ok) lastHeartbeat = Date.now();
    return ok;
  };

  // 処理開始直後に一度heartbeat(リース確認)
  if (!(await heartbeat())) {
    result.leaseLost += 1;
    return;
  }

  try {
    const handlerResult = await handler(job, {
      workerId,
      heartbeat: async () => {
        const elapsed = (Date.now() - lastHeartbeat) / 1000;
        if (elapsed >= heartbeatIntervalSeconds) {
          return heartbeat();
        }
        // 間隔内でも外部作用直前は呼び出し側が明示heartbeatする想定
        return true;
      },
    });

    // 外部作用後の結果書込直前にもリース確認
    if (!(await heartbeat())) {
      result.leaseLost += 1;
      return;
    }

    if (handlerResult.status === "succeeded") {
      const ok = await completeJob(job.id, workerId, handlerResult.result);
      if (!ok) {
        result.leaseLost += 1;
        return;
      }
      result.succeeded += 1;
      return;
    }

    const message =
      handlerResult.status === "retry"
        ? handlerResult.errorMessage
        : handlerResult.errorMessage;
    const backoff =
      handlerResult.status === "retry" && handlerResult.backoffSeconds != null
        ? handlerResult.backoffSeconds
        : computeBackoffSeconds(job.attempts);

    const ok = await failJob(job.id, workerId, message, backoff);
    if (!ok) {
      result.leaseLost += 1;
      return;
    }

    if (handlerResult.status === "failed" || job.attempts >= job.max_attempts) {
      result.failed += 1;
    } else {
      result.retried += 1;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ジョブ処理中に不明なエラー";
    result.errors.push(`${job.id}: ${message}`);
    try {
      const ok = await failJob(
        job.id,
        workerId,
        message,
        computeBackoffSeconds(job.attempts),
      );
      if (!ok) {
        result.leaseLost += 1;
        return;
      }
      if (job.attempts >= job.max_attempts) {
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    } catch (failError) {
      result.errors.push(
        failError instanceof Error
          ? failError.message
          : "fail_job呼び出しに失敗",
      );
    }
  }
}


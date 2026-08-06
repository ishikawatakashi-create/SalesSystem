/**
 * claim_next_job / heartbeat / complete / fail の意味論モデル。
 * 実DB適用前の単体テスト用。マイグレーションSQLと同一ルールを維持すること。
 */

export type SimulatedJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SimulatedJob = {
  id: string;
  kind: string;
  priority: number;
  status: SimulatedJobStatus;
  locked_by: string | null;
  lease_expires_at: number | null;
  attempts: number;
  max_attempts: number;
  next_run_at: number;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export class JobRpcSimulator {
  private jobs: SimulatedJob[] = [];
  private nowMs: number;

  constructor(nowMs: number = Date.now()) {
    this.nowMs = nowMs;
  }

  setNow(ms: number): void {
    this.nowMs = ms;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }

  seed(job: Omit<SimulatedJob, "created_at"> & { created_at?: number }): SimulatedJob {
    const row: SimulatedJob = {
      ...job,
      created_at: job.created_at ?? this.nowMs,
    };
    this.jobs.push(row);
    return row;
  }

  get(id: string): SimulatedJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  all(): SimulatedJob[] {
    return [...this.jobs];
  }

  claimNextJob(workerId: string, leaseSeconds: number = 300): SimulatedJob | null {
    // 1) リース切れかつ attempts >= max → failed
    for (const j of this.jobs) {
      if (
        j.status === "running" &&
        j.lease_expires_at != null &&
        j.lease_expires_at < this.nowMs &&
        j.attempts >= j.max_attempts
      ) {
        j.status = "failed";
        j.error_message =
          j.error_message ?? "lease expired; max_attempts exceeded";
        j.finished_at = this.nowMs;
      }
    }

    // 2) SKIP LOCKED相当: 候補をpriority, created_at順で1件
    const candidates = this.jobs
      .filter(
        (j) =>
          j.attempts < j.max_attempts &&
          ((j.status === "queued" && j.next_run_at <= this.nowMs) ||
            (j.status === "running" &&
              j.lease_expires_at != null &&
              j.lease_expires_at < this.nowMs)),
      )
      .sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);

    const j = candidates[0];
    if (!j) return null;

    j.status = "running";
    j.locked_by = workerId;
    j.lease_expires_at = this.nowMs + leaseSeconds * 1000;
    j.attempts += 1;
    j.started_at = j.started_at ?? this.nowMs;
    return { ...j };
  }

  /** 同時claimを直列化して競合を検証 */
  claimConcurrent(
    workerIds: string[],
    leaseSeconds: number = 300,
  ): Array<SimulatedJob | null> {
    return workerIds.map((id) => this.claimNextJob(id, leaseSeconds));
  }

  heartbeatJob(
    jobId: string,
    workerId: string,
    leaseSeconds: number = 300,
  ): boolean {
    const j = this.get(jobId);
    if (!j) return false;
    if (
      j.locked_by !== workerId ||
      j.status !== "running" ||
      j.lease_expires_at == null ||
      j.lease_expires_at <= this.nowMs
    ) {
      return false;
    }
    j.lease_expires_at = this.nowMs + leaseSeconds * 1000;
    return true;
  }

  completeJob(jobId: string, workerId: string): boolean {
    const j = this.get(jobId);
    if (!j) return false;
    if (
      j.locked_by !== workerId ||
      j.status !== "running" ||
      j.lease_expires_at == null ||
      j.lease_expires_at <= this.nowMs
    ) {
      return false;
    }
    j.status = "succeeded";
    j.finished_at = this.nowMs;
    j.error_message = null;
    return true;
  }

  failJob(
    jobId: string,
    workerId: string,
    errorMessage: string,
    backoffSeconds: number,
  ): boolean {
    const j = this.get(jobId);
    if (!j) return false;
    if (
      j.locked_by !== workerId ||
      j.status !== "running" ||
      j.lease_expires_at == null ||
      j.lease_expires_at <= this.nowMs
    ) {
      return false;
    }

    if (j.attempts < j.max_attempts) {
      j.status = "queued";
      j.locked_by = null;
      j.lease_expires_at = null;
      j.next_run_at = this.nowMs + Math.max(backoffSeconds, 1) * 1000;
      j.error_message = errorMessage;
    } else {
      j.status = "failed";
      j.finished_at = this.nowMs;
      j.error_message = errorMessage;
    }
    return true;
  }
}

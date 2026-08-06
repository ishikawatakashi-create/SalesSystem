import { describe, expect, it } from "vitest";

import { computeBackoffSeconds } from "@/lib/jobs/backoff";
import { JobRpcSimulator } from "@/lib/jobs/rpc-semantics";
import { verifyCronSecret } from "@/lib/jobs/cron-secret";

describe("claim_next_job意味論", () => {
  it("同時取得で同じジョブを複数ワーカーが取らない", () => {
    const sim = new JobRpcSimulator(1_000_000);
    sim.seed({
      id: "j1",
      kind: "storage_cleanup",
      priority: 100,
      status: "queued",
      locked_by: null,
      lease_expires_at: null,
      attempts: 0,
      max_attempts: 5,
      next_run_at: 1_000_000,
      error_message: null,
      started_at: null,
      finished_at: null,
    });

    const claimed = sim.claimConcurrent(["w1", "w2", "w3"]);
    const nonNull = claimed.filter(Boolean);
    expect(nonNull).toHaveLength(1);
    expect(nonNull[0]?.locked_by).toBe("w1");
    expect(sim.get("j1")?.attempts).toBe(1);
  });

  it("リース切れジョブを安全に回収する", () => {
    const sim = new JobRpcSimulator(1_000_000);
    sim.seed({
      id: "j1",
      kind: "webhook_sync",
      priority: 50,
      status: "running",
      locked_by: "old-worker",
      lease_expires_at: 900_000,
      attempts: 1,
      max_attempts: 5,
      next_run_at: 0,
      error_message: null,
      started_at: 800_000,
      finished_at: null,
    });

    const claimed = sim.claimNextJob("new-worker");
    expect(claimed?.locked_by).toBe("new-worker");
    expect(claimed?.attempts).toBe(2);
    expect(sim.heartbeatJob("j1", "old-worker")).toBe(false);
  });

  it("旧ワーカーのheartbeatを拒否する", () => {
    const sim = new JobRpcSimulator(1_000_000);
    sim.seed({
      id: "j1",
      kind: "csv_import",
      priority: 10,
      status: "running",
      locked_by: "w1",
      lease_expires_at: 1_100_000,
      attempts: 1,
      max_attempts: 5,
      next_run_at: 0,
      error_message: null,
      started_at: 1_000_000,
      finished_at: null,
    });

    expect(sim.heartbeatJob("j1", "w2")).toBe(false);

    // リース有効中は所有者のみ成功
    expect(sim.heartbeatJob("j1", "w1", 100)).toBe(true);
    // 上記heartbeatで lease = now+100s = 1_100_000
    sim.setNow(1_100_001);
    expect(sim.heartbeatJob("j1", "w1")).toBe(false);
    expect(sim.completeJob("j1", "w1")).toBe(false);
    expect(sim.failJob("j1", "w1", "late", 30)).toBe(false);
  });

  it("attempts上限超過時はfailedへ遷移する", () => {
    const sim = new JobRpcSimulator(1_000_000);
    sim.seed({
      id: "j1",
      kind: "sync_repair",
      priority: 100,
      status: "running",
      locked_by: "dead",
      lease_expires_at: 500_000,
      attempts: 5,
      max_attempts: 5,
      next_run_at: 0,
      error_message: null,
      started_at: 0,
      finished_at: null,
    });

    expect(sim.claimNextJob("w1")).toBeNull();
    expect(sim.get("j1")?.status).toBe("failed");
  });

  it("fail後はバックオフ付きでqueuedへ戻る", () => {
    const sim = new JobRpcSimulator(1_000_000);
    sim.seed({
      id: "j1",
      kind: "bulk_activity",
      priority: 100,
      status: "running",
      locked_by: "w1",
      lease_expires_at: 1_500_000,
      attempts: 2,
      max_attempts: 5,
      next_run_at: 0,
      error_message: null,
      started_at: 1_000_000,
      finished_at: null,
    });

    const backoff = computeBackoffSeconds(2);
    expect(sim.failJob("j1", "w1", "temporary", backoff)).toBe(true);
    const job = sim.get("j1");
    expect(job?.status).toBe("queued");
    expect(job?.locked_by).toBeNull();
    expect(job?.next_run_at).toBe(1_000_000 + backoff * 1000);
    expect(sim.claimNextJob("w2")).toBeNull();

    sim.advance(backoff * 1000);
    expect(sim.claimNextJob("w2")?.locked_by).toBe("w2");
  });
});

describe("CRON_SECRET検証", () => {
  it("一致時のみ許可する", () => {
    expect(verifyCronSecret("secret", "secret")).toBe(true);
    expect(verifyCronSecret("Bearer secret", "secret")).toBe(true);
    expect(verifyCronSecret("wrong", "secret")).toBe(false);
    expect(verifyCronSecret(null, "secret")).toBe(false);
    expect(verifyCronSecret("secret", undefined)).toBe(false);
  });
});

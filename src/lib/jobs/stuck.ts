import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type StuckJobsSummary = {
  overdueQueued: number;
  expiredRunning: number;
  /** overdueQueued + expiredRunning */
  total: number;
};

/**
 * 滞留ジョブ検知。
 * - queuedのまま next_run_at を過ぎている
 * - runningのままリース切れ
 */
export async function detectStuckJobs(now: Date = new Date()): Promise<StuckJobsSummary> {
  const admin = createAdminClient();
  const iso = now.toISOString();

  const [queued, running] = await Promise.all([
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("next_run_at", iso),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running")
      .lt("lease_expires_at", iso),
  ]);

  if (queued.error) {
    throw new Error(`滞留queued検知に失敗しました: ${queued.error.message}`);
  }
  if (running.error) {
    throw new Error(`滞留running検知に失敗しました: ${running.error.message}`);
  }

  const overdueQueued = queued.count ?? 0;
  const expiredRunning = running.count ?? 0;
  return {
    overdueQueued,
    expiredRunning,
    total: overdueQueued + expiredRunning,
  };
}

/**
 * ジョブワーカーの設定値。
 * 規約: heartbeat間隔 ≤ リース期間の1/3(docs/supabase-schema.md §6)。
 * リース切れ後の旧ワーカーはheartbeat・完了・失敗報告が拒否される(falseが返る)ため、
 * この比率を守らないと生きているワーカーのジョブが回収され二重処理になり得る。
 * 単体テスト(tests/jobs-config.test.ts)で担保する。
 */
export const JOB_LEASE_SECONDS = 300;
export const JOB_HEARTBEAT_INTERVAL_SECONDS = 60;

/** heartbeat間隔がリース期間に対して安全か(規約: 1/3以下) */
export function isHeartbeatIntervalSafe(
  heartbeatIntervalSeconds: number,
  leaseSeconds: number,
): boolean {
  return (
    heartbeatIntervalSeconds > 0 &&
    heartbeatIntervalSeconds <= leaseSeconds / 3
  );
}

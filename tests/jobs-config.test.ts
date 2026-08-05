import { describe, expect, it } from "vitest";
import {
  JOB_HEARTBEAT_INTERVAL_SECONDS,
  JOB_LEASE_SECONDS,
  isHeartbeatIntervalSafe,
} from "@/lib/jobs/config";

describe("ジョブワーカー設定(docs/supabase-schema.md §6の規約)", () => {
  it("heartbeat間隔はリース期間の1/3以下であること", () => {
    expect(
      isHeartbeatIntervalSafe(JOB_HEARTBEAT_INTERVAL_SECONDS, JOB_LEASE_SECONDS),
    ).toBe(true);
    expect(JOB_HEARTBEAT_INTERVAL_SECONDS).toBeLessThanOrEqual(
      JOB_LEASE_SECONDS / 3,
    );
  });

  it("リース期間ぎりぎり・超過のheartbeat間隔は不安全と判定する", () => {
    expect(isHeartbeatIntervalSafe(150, 300)).toBe(false);
    expect(isHeartbeatIntervalSafe(300, 300)).toBe(false);
    expect(isHeartbeatIntervalSafe(400, 300)).toBe(false);
    expect(isHeartbeatIntervalSafe(0, 300)).toBe(false);
  });

  it("十分短い間隔は安全と判定する", () => {
    expect(isHeartbeatIntervalSafe(60, 300)).toBe(true);
    expect(isHeartbeatIntervalSafe(100, 300)).toBe(true);
  });
});

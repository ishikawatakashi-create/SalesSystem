import { describe, expect, it, vi } from "vitest";

import { NotionRateLimiterSimulator } from "@/lib/notion/rate-limiter-semantics";
import {
  SupabaseNotionRateLimiter,
  withNotionRateLimit,
} from "@/lib/notion/rate-limiter-core";

describe("notion_rate_limiter枠予約", () => {
  it("各予約で1枠ずつ進め、bulkはinteractiveより間隔が広い", () => {
    const sim = new NotionRateLimiterSimulator({
      nowMs: 1_000_000,
      minIntervalMs: 350,
    });

    const interactive = sim.reserveSlot("interactive");
    expect(interactive).toBe(1_000_000 + 350);

    sim.setNow(1_000_000);
    const bulk = sim.reserveSlot("bulk");
    // next_slot_atはinteractive予約後なので、そこからbulk係数2
    expect(bulk).toBe(interactive + 350 * 2);
  });

  it("blocked_until中は予約基準が延びる", () => {
    const sim = new NotionRateLimiterSimulator({
      nowMs: 1_000_000,
      minIntervalMs: 350,
    });
    sim.reportRateLimited(10);
    expect(sim.blockedUntil).toBe(1_010_000);

    const slot = sim.reserveSlot("bulk");
    expect(slot).toBe(1_010_000 + 700);
  });

  it("送信直前の再確認でblocked_untilを破らない", () => {
    const sim = new NotionRateLimiterSimulator({
      nowMs: 1_000_000,
      minIntervalMs: 350,
    });
    const slot = sim.reserveSlot("interactive");
    sim.setNow(slot);
    sim.reportRateLimited(5);
    expect(sim.recheckBlockedUntil()).toBe(slot + 5_000);

    sim.setNow(slot + 5_000);
    expect(sim.recheckBlockedUntil()).toBeNull();
  });
});

describe("SupabaseNotionRateLimiterモジュール", () => {
  it("reserve→wait→sendの共通経路を使う", async () => {
    const sleep = vi.fn(async () => undefined) as unknown as (
      ms: number,
    ) => Promise<void>;
    let now = 1_000_000;
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "reserve_notion_slot") {
        return { data: new Date(now + 100).toISOString(), error: null };
      }
      if (fn === "get_notion_rate_limiter_state") {
        return {
          data: [
            {
              next_slot_at: new Date(now).toISOString(),
              blocked_until: null,
              min_interval_ms: 350,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected ${fn}` } };
    });

    const limiter = new SupabaseNotionRateLimiter({
      createClient: () => ({ rpc }),
      now: () => new Date(now),
      sleep: async (ms) => {
        now += ms;
        await sleep(ms);
      },
    });

    const send = vi.fn(async () => "ok");
    const result = await withNotionRateLimit(limiter, "bulk", send);
    expect(result).toBe("ok");
    expect(send).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("reserve_notion_slot", {
      p_priority: "bulk",
    });
    expect(sleep).toHaveBeenCalled();
    expect(limiter.bulkConcurrency).toBe(1);
  });

  it("429報告RPCを呼ぶ", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const limiter = new SupabaseNotionRateLimiter({
      createClient: () => ({ rpc }),
    });
    await limiter.reportRateLimited(12);
    expect(rpc).toHaveBeenCalledWith("report_notion_rate_limited", {
      p_retry_after_seconds: 12,
    });
  });
});

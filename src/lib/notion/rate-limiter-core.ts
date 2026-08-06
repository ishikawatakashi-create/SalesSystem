/**
 * 分散Notionレートリミッターのコア(純ロジック+RPCクライアント注入)。
 * server-onlyに依存しないため単体テスト可能。
 */

export type NotionRequestPriority = "interactive" | "bulk";

export type ReservedSlot = {
  waitUntil: Date;
};

export interface NotionRateLimiter {
  reserveSlot(priority?: NotionRequestPriority): Promise<ReservedSlot>;
  waitUntilAllowed(slot: ReservedSlot): Promise<void>;
  reportRateLimited(retryAfterSeconds: number): Promise<void>;
  readonly bulkConcurrency: 1;
}

export type AdminRpcClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

export type SupabaseNotionRateLimiterOptions = {
  createClient: () => AdminRpcClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export class SupabaseNotionRateLimiter implements NotionRateLimiter {
  readonly bulkConcurrency = 1 as const;
  private readonly createClient: () => AdminRpcClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxWaitMs: number;

  constructor(options: SupabaseNotionRateLimiterOptions) {
    this.createClient = options.createClient;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
  }

  async reserveSlot(
    priority: NotionRequestPriority = "bulk",
  ): Promise<ReservedSlot> {
    const client = this.createClient();
    const { data, error } = await client.rpc("reserve_notion_slot", {
      p_priority: priority,
    });
    if (error) {
      throw new Error(`reserve_notion_slotに失敗しました: ${error.message}`);
    }
    if (typeof data !== "string") {
      throw new Error("reserve_notion_slotの返却値が不正です");
    }
    return { waitUntil: new Date(data) };
  }

  async waitUntilAllowed(slot: ReservedSlot): Promise<void> {
    let waitUntil = slot.waitUntil;
    const deadline = this.now().getTime() + this.maxWaitMs;

    for (;;) {
      const remaining = waitUntil.getTime() - this.now().getTime();
      if (remaining > 0) {
        if (this.now().getTime() + remaining > deadline) {
          throw new Error("レートリミット待機が上限を超えました");
        }
        await this.sleep(remaining);
      }

      const state = await this.getState();
      if (
        state.blockedUntil &&
        state.blockedUntil.getTime() > this.now().getTime()
      ) {
        waitUntil = state.blockedUntil;
        continue;
      }
      return;
    }
  }

  async reportRateLimited(retryAfterSeconds: number): Promise<void> {
    const client = this.createClient();
    const { error } = await client.rpc("report_notion_rate_limited", {
      p_retry_after_seconds: Math.max(1, Math.floor(retryAfterSeconds)),
    });
    if (error) {
      throw new Error(
        `report_notion_rate_limitedに失敗しました: ${error.message}`,
      );
    }
  }

  private async getState(): Promise<{
    nextSlotAt: Date;
    blockedUntil: Date | null;
    minIntervalMs: number;
  }> {
    const client = this.createClient();
    const { data, error } = await client.rpc("get_notion_rate_limiter_state");
    if (error) {
      throw new Error(
        `get_notion_rate_limiter_stateに失敗しました: ${error.message}`,
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") {
      throw new Error("レートリミッター状態が取得できません");
    }
    const record = row as {
      next_slot_at: string;
      blocked_until: string | null;
      min_interval_ms: number;
    };
    return {
      nextSlotAt: new Date(record.next_slot_at),
      blockedUntil: record.blocked_until
        ? new Date(record.blocked_until)
        : null,
      minIntervalMs: record.min_interval_ms,
    };
  }
}

export async function withNotionRateLimit<T>(
  limiter: NotionRateLimiter,
  priority: NotionRequestPriority,
  send: () => Promise<T>,
): Promise<T> {
  const slot = await limiter.reserveSlot(priority);
  await limiter.waitUntilAllowed(slot);
  return send();
}

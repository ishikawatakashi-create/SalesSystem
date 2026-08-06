/**
 * notion_rate_limiter RPCの意味論モデル(実DBなしテスト用)。
 */

export type RateLimiterPriority = "interactive" | "bulk";

export class NotionRateLimiterSimulator {
  nextSlotAt: number;
  blockedUntil: number | null = null;
  minIntervalMs: number;
  private nowMs: number;

  constructor(options?: { nowMs?: number; minIntervalMs?: number }) {
    this.nowMs = options?.nowMs ?? Date.now();
    this.minIntervalMs = options?.minIntervalMs ?? 350;
    this.nextSlotAt = this.nowMs;
  }

  setNow(ms: number): void {
    this.nowMs = ms;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }

  reserveSlot(priority: RateLimiterPriority = "bulk"): number {
    const factor = priority === "interactive" ? 1 : 2;
    const base = Math.max(
      this.nowMs,
      this.nextSlotAt,
      this.blockedUntil ?? this.nowMs,
    );
    this.nextSlotAt = base + this.minIntervalMs * factor;
    return this.nextSlotAt;
  }

  reportRateLimited(retryAfterSeconds: number): void {
    const until = this.nowMs + Math.max(1, retryAfterSeconds) * 1000;
    this.blockedUntil = Math.max(this.blockedUntil ?? this.nowMs, until);
  }

  /** 送信直前のblocked_until再確認。追加待機が必要ならその時刻、なければnull */
  recheckBlockedUntil(): number | null {
    if (this.blockedUntil != null && this.blockedUntil > this.nowMs) {
      return this.blockedUntil;
    }
    return null;
  }
}

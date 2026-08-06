import { describe, expect, it, vi } from "vitest";

import {
  backoffMs,
  createNotionClient,
  NotionHttpError,
  parseRetryAfterSeconds,
} from "@/lib/notion/client-core";
import { NOTION_API_VERSION } from "@/lib/notion/version";
import type { NotionRateLimiter } from "@/lib/notion/rate-limiter-core";

function mockLimiter(): NotionRateLimiter & {
  reserved: number;
  reported: number[];
} {
  let reserved = 0;
  const reported: number[] = [];
  return {
    bulkConcurrency: 1 as const,
    async reserveSlot() {
      reserved += 1;
      return { waitUntil: new Date(0) };
    },
    async waitUntilAllowed() {},
    async reportRateLimited(seconds: number) {
      reported.push(seconds);
    },
    get reserved() {
      return reserved;
    },
    get reported() {
      return reported;
    },
  };
}

describe("Notion client", () => {
  it("APIバージョンは2026-03-11", () => {
    expect(NOTION_API_VERSION).toBe("2026-03-11");
  });

  it("全リクエストがrate limiterを通る", async () => {
    const limiter = mockLimiter();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ object: "user", id: "u" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createNotionClient({
      token: "secret_test_token",
      rateLimiter: limiter,
      fetchImpl,
    });
    await client.request({ path: "users/me", method: "get" });
    expect(calls).toBeGreaterThan(0);
    expect(limiter.reserved).toBeGreaterThan(0);
  });

  it("429はRetry-Afterを報告して再試行する", async () => {
    const limiter = mockLimiter();
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("{}", {
          status: 429,
          headers: { "Retry-After": "2", "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ object: "user", id: "u" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createNotionClient({
      token: "secret_test_token",
      rateLimiter: limiter,
      fetchImpl,
      sleep,
      maxRetries: 3,
    });
    await client.request({ path: "users/me", method: "get" });
    expect(limiter.reported).toContain(2);
    expect(parseRetryAfterSeconds("2")).toBe(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("5xx GETはバックオフ、書込は曖昧失敗", async () => {
    expect(backoffMs(1)).toBe(200);
    const limiter = mockLimiter();
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const client = createNotionClient({
      token: "secret_test_token",
      rateLimiter: limiter,
      fetchImpl,
      sleep,
      maxRetries: 1,
    });
    await expect(
      client.request({ path: "pages", method: "post", body: {} }),
    ).rejects.toMatchObject({ code: "write_ambiguous_failure" });
  });

  it("401/403は再試行しない", async () => {
    const limiter = mockLimiter();
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 401 }),
    );
    const client = createNotionClient({
      token: "secret_test_token",
      rateLimiter: limiter,
      fetchImpl,
      sleep,
      maxRetries: 3,
    });
    await expect(
      client.request({ path: "users/me", method: "get" }),
    ).rejects.toBeInstanceOf(NotionHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("トークンをログへ出さない", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((msg) => {
      lines.push(String(msg));
    });
    const { logNotionInfo } = await import("@/lib/notion/logger");
    logNotionInfo({
      request_id: "r",
      authorization: "Bearer secret_abc",
      token: "ntn_xxx",
      message: "ok",
    });
    spy.mockRestore();
    const joined = lines.join("\n");
    expect(joined).not.toContain("secret_abc");
    expect(joined).not.toContain("ntn_xxx");
    expect(joined).toContain("[redacted]");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
      upsert: async () => ({ data: null }),
    }),
  })),
}));

import { storageCleanupIdempotencyKey } from "@/lib/jobs/daily-maintenance";

describe("storageCleanupIdempotencyKey", () => {
  it("YYYY-MM-DD から日次キーを組み立てる", () => {
    expect(storageCleanupIdempotencyKey("2026-08-07")).toBe(
      "storage_cleanup:2026-08-07",
    );
  });

  it("日付部分をそのまま埋め込む(バリデーションは呼び出し側)", () => {
    expect(storageCleanupIdempotencyKey("2026-01-01")).toBe(
      "storage_cleanup:2026-01-01",
    );
  });
});

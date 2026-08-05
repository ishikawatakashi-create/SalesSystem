import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/auth/normalize-email";

describe("normalizeEmail(DB側 lower(trim(...)) と同一結果であること)", () => {
  it("小文字化する", () => {
    expect(normalizeEmail("Taro.Yamada@Example.COM")).toBe(
      "taro.yamada@example.com",
    );
  });

  it("前後の空白を除去する", () => {
    expect(normalizeEmail("  user@example.com \t")).toBe("user@example.com");
  });

  it("正規化済みのアドレスは変化しない", () => {
    expect(normalizeEmail("user@example.com")).toBe("user@example.com");
  });
});

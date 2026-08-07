import { describe, expect, it } from "vitest";

import { sanitizeIlikeTerm, toIlikePattern } from "@/lib/search/escape";

describe("sanitizeIlikeTerm", () => {
  it("% と _ を除去してワイルドカード注入を防ぐ", () => {
    expect(sanitizeIlikeTerm("100%_off")).toBe("100off");
    expect(sanitizeIlikeTerm("%foo_")).toBe("foo");
  });

  it("PostgREST or 構文を壊す文字を除去", () => {
    expect(sanitizeIlikeTerm("a,b(c)")).toBe("a b c");
    expect(sanitizeIlikeTerm(`foo"bar`)).toBe("foo bar");
  });

  it("空白を正規化", () => {
    expect(sanitizeIlikeTerm("  株式会社   テスト  ")).toBe("株式会社 テスト");
  });
});

describe("toIlikePattern", () => {
  it("前後に % を付与。空は null", () => {
    expect(toIlikePattern("abc")).toBe("%abc%");
    expect(toIlikePattern("%%%")).toBeNull();
    expect(toIlikePattern("   ")).toBeNull();
    expect(toIlikePattern("%_")).toBeNull();
  });
});

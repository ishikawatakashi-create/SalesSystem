import { describe, expect, it } from "vitest";

import {
  buildCustomerSearchText,
  buildCustomerSearchTextKana,
  emptyToNull,
  normalizeCompanyNameForSearch,
  normalizeEmailOrNull,
  normalizeKanaForSearch,
  normalizePhone,
  normalizePostalCode,
  normalizeUrl,
  sanitizeUrlForStorage,
} from "@/lib/normalize";

describe("normalize text/empty", () => {
  it("空文字と空白のみをnullにする", () => {
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull(" a ")).toBe("a");
  });
});

describe("normalize phone/postal/email/url", () => {
  it("電話番号は数字のみ", () => {
    expect(normalizePhone("03-1234-5678")).toBe("0312345678");
    expect(normalizePhone("０３−１２３４−５６７８")).toBe("0312345678");
    expect(normalizePhone("")).toBeNull();
  });

  it("郵便番号は数字のみ", () => {
    expect(normalizePostalCode("123-4567")).toBe("1234567");
    expect(normalizePostalCode("１２３ー４５６７")).toBe("1234567");
  });

  it("メールはtrim+lower", () => {
    expect(normalizeEmailOrNull(" Foo@Example.COM ")).toBe("foo@example.com");
    expect(normalizeEmailOrNull("")).toBeNull();
  });

  it("URLは空をnull、スキーム補完", () => {
    expect(sanitizeUrlForStorage("")).toBeNull();
    expect(normalizeUrl("example.com")).toMatch(/^https:\/\/example\.com\/?$/);
    expect(normalizeUrl("ftp://x")).toBeNull();
  });
});

describe("normalize company/kana/search", () => {
  it("法人格・異体字・空白を正規化", () => {
    expect(normalizeCompanyNameForSearch("株式会社　髙橋")).toContain("高");
    expect(normalizeCompanyNameForSearch("株式会社テスト")).toContain("(株)");
  });

  it("かなをひらがなへ", () => {
    expect(normalizeKanaForSearch("ヤマダ")).toBe("やまだ");
  });

  it("search_textを生成", () => {
    const text = buildCustomerSearchText({
      displayName: "株式会社テスト",
      legalName: "株式会社テスト",
      officeName: null,
      prefecture: "東京都",
      city: "渋谷区",
      addressLine: null,
      phone: "03-1111-2222",
      email: "A@B.com",
      representativeName: null,
    });
    expect(text).toContain("0311112222");
    expect(text).toContain("a@b.com");
    expect(buildCustomerSearchTextKana({
      displayName: "テスト",
      legalName: null,
      officeName: null,
      prefecture: null,
      city: null,
      addressLine: null,
      phone: null,
      email: null,
      representativeName: null,
    })).toContain("てすと");
  });
});

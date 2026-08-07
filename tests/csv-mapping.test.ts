import { describe, expect, it } from "vitest";
import { suggestMapping, validateMapping } from "@/lib/csv/mapping";

describe("suggestMapping", () => {
  it("顧客アカウントのヘッダーを推測できる", () => {
    const headers = ["会社名", "電話番号", "メールアドレス", "都道府県"];
    const result = suggestMapping(headers, "customers");

    expect(result["会社名"]).toBe("displayName");
    expect(result["電話番号"]).toBe("phone");
    expect(result["メールアドレス"]).toBe("email");
    expect(result["都道府県"]).toBe("prefecture");
  });

  it("顧客担当者のヘッダーを推測できる", () => {
    const headers = ["氏名", "メール", "役職", "部署"];
    const result = suggestMapping(headers, "contacts");

    expect(result["氏名"]).toBe("name");
    expect(result["メール"]).toBe("email");
    expect(result["役職"]).toBe("title");
    expect(result["部署"]).toBe("department");
  });

  it("マッピング不明なヘッダーはnullになる", () => {
    const headers = ["不明な列", "謎のフィールド"];
    const result = suggestMapping(headers, "customers");

    expect(result["不明な列"]).toBeNull();
    expect(result["謎のフィールド"]).toBeNull();
  });

  it("空白を正規化して推測する", () => {
    const headers = ["  会社名  ", "電話番号"];
    const result = suggestMapping(headers, "customers");

    expect(result["  会社名  "]).toBe("displayName");
    expect(result["電話番号"]).toBe("phone");
  });
});

describe("validateMapping", () => {
  it("正しいマッピングは検証に合格する", () => {
    const mapping = {
      会社名: "displayName",
      電話番号: "phone",
      メール: "email",
    };

    const result = validateMapping(mapping, "customers");

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("必須フィールドが不足している場合エラー", () => {
    const mapping = {
      電話番号: "phone",
      // displayName が不足
    };

    const result = validateMapping(mapping, "customers");

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("required_missing");
    expect(result.errors[0]?.fieldKey).toBe("displayName");
  });

  it("重複するターゲットフィールドを検出する", () => {
    const mapping = {
      会社名: "displayName",
      企業名: "displayName", // 重複
    };

    const result = validateMapping(mapping, "customers");

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("duplicate_target");
    expect(result.errors[0]?.fieldKey).toBe("displayName");
  });

  it("unsupportedフィールドへのマッピングを検出する", () => {
    const mapping = {
      会社名: "displayName",
      見込み金額: "expectedAmount", // unsupported
    };

    const result = validateMapping(mapping, "customers");

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("unsupported_field");
    expect(result.errors[0]?.fieldKey).toBe("expectedAmount");
  });

  it("複数のエラーを検出する", () => {
    const mapping = {
      電話番号: "phone",
      // displayName 不足
      見込み金額: "expectedAmount", // unsupported
    };

    const result = validateMapping(mapping, "customers");

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

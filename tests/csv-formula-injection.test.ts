import { describe, expect, it } from "vitest";
import { sanitizeCsvCellForExport } from "@/lib/csv/formula-injection";

describe("sanitizeCsvCellForExport", () => {
  it("= で始まる値に ' を付与する", () => {
    const input = "=SUM(A1:A10)";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'=SUM(A1:A10)");
  });

  it("+ で始まる値に ' を付与する", () => {
    const input = "+1234";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'+1234");
  });

  it("@ で始まる値に ' を付与する", () => {
    const input = "@command";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'@command");
  });

  it("- で始まる値に ' を付与する", () => {
    const input = "-1234";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'-1234");
  });

  it("タブで始まる値に ' を付与する", () => {
    const input = "\ttabbed";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'\ttabbed");
  });

  it("CRで始まる値に ' を付与する", () => {
    const input = "\rcarriage";
    const result = sanitizeCsvCellForExport(input);

    expect(result).toBe("'\rcarriage");
  });

  it("安全な値はそのまま返す", () => {
    expect(sanitizeCsvCellForExport("Hello")).toBe("Hello");
    expect(sanitizeCsvCellForExport("123")).toBe("123");
    expect(sanitizeCsvCellForExport("foo@bar.com")).toBe("foo@bar.com");
    expect(sanitizeCsvCellForExport("株式会社テスト")).toBe("株式会社テスト");
  });

  it("空文字列はそのまま返す", () => {
    expect(sanitizeCsvCellForExport("")).toBe("");
  });

  it("途中に危険な文字がある場合は変更しない", () => {
    expect(sanitizeCsvCellForExport("A=B")).toBe("A=B");
    expect(sanitizeCsvCellForExport("test+value")).toBe("test+value");
  });
});

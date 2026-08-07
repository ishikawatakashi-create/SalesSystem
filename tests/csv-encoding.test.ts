import { describe, expect, it } from "vitest";
import { decodeCsvBuffer, CsvEncodingError } from "@/lib/csv/encoding";

describe("decodeCsvBuffer", () => {
  it("UTF-8 BOMありのCSVをデコードできる", () => {
    const text = "名前,年齢\n山田,30";
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const buf = Buffer.concat([bom, Buffer.from(text, "utf-8")]);

    const result = decodeCsvBuffer(buf, "auto");

    expect(result.text).toBe(text);
    expect(result.encoding).toBe("utf-8-bom");
  });

  it("UTF-8 BOMなしのCSVをデコードできる", () => {
    const text = "名前,年齢\n山田,30";
    const buf = Buffer.from(text, "utf-8");

    const result = decodeCsvBuffer(buf, "auto");

    expect(result.text).toBe(text);
    expect(result.encoding).toBe("utf-8");
  });

  it("明示的にutf-8を指定してデコードできる", () => {
    const text = "名前,年齢\n山田,30";
    const buf = Buffer.from(text, "utf-8");

    const result = decodeCsvBuffer(buf, "utf-8");

    expect(result.text).toBe(text);
    expect(result.encoding).toBe("utf-8");
  });

  it("不正なUTF-8バイト列でエラー", () => {
    // 不正なUTF-8シーケンス
    const buf = Buffer.from([0xff, 0xfe, 0xfd]);

    expect(() => decodeCsvBuffer(buf, "utf-8")).toThrow(/UTF-8 デコードに失敗/);
  });

  it("Shift_JIS をデコードできる（環境がサポートしている場合）", () => {
    // "あいうえお" in Shift_JIS
    const buf = Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x82, 0xa6, 0x82, 0xa8]);

    try {
      const result = decodeCsvBuffer(buf, "cp932");
      expect(result.text).toBe("あいうえお");
      expect(result.encoding).toBe("shift_jis");
    } catch (e: unknown) {
      // 環境がShift_JISをサポートしていない場合はスキップ
      if (e instanceof CsvEncodingError) {
        expect(e.message).toMatch(/Shift_JIS/);
      } else {
        throw e;
      }
    }
  });

  it("autoモードでUTF-8失敗時にShift_JISを試す", () => {
    // Shift_JIS バイト列
    const buf = Buffer.from([0x82, 0xa0, 0x82, 0xa2]);

    try {
      const result = decodeCsvBuffer(buf, "auto");
      // UTF-8として無効なので、Shift_JISにフォールバック
      expect(result.encoding).toBe("shift_jis");
    } catch (e: unknown) {
      // 環境がShift_JISをサポートしていない場合
      if (e instanceof CsvEncodingError) {
        expect(e.message).toMatch(/自動検出に失敗/);
      } else {
        throw e;
      }
    }
  });
});

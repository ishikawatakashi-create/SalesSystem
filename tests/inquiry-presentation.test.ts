import { describe, expect, it } from "vitest";

import {
  formatAttachmentSize,
  inquiryParseWarningLabel,
  inquirySourceLabel,
} from "@/lib/inquiries/presentation";

describe("inquiry presentation", () => {
  it("受信元と解析警告の内部コードを利用者向けに変換する", () => {
    expect(inquirySourceLabel("strikingly_email")).toBe("Webフォームから受信");
    expect(inquirySourceLabel("unknown_source")).toBe("その他の受信経路");

    for (const code of [
      "empty_body",
      "unknown_template",
      "sparse_fields",
      "source_body_incomplete",
      "unknown_internal_code",
    ]) {
      const label = inquiryParseWarningLabel(code);
      expect(label).not.toContain(code);
      expect(label).toMatch(/[ぁ-んァ-ヶ一-鿿]/);
    }
  });

  it("添付サイズを読みやすい単位で表示する", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(1536)).toBe("2 KB");
    expect(formatAttachmentSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatAttachmentSize("invalid")).toBeNull();
  });
});

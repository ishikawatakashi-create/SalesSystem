import { describe, expect, it } from "vitest";

import {
  canonicalizeContactWriteInput,
  hashContactWriteInput,
  sanitizeContactWriteInput,
} from "@/lib/contacts/input-hash";
import type { ContactWriteInput } from "@/lib/contacts/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";

function sample(over: Partial<ContactWriteInput> = {}): ContactWriteInput {
  return {
    name: "山田太郎",
    nameKana: "ヤマダタロウ",
    customerPageId: CUSTOMER,
    department: "営業部",
    title: "部長",
    phone: "03-1234-5678",
    email: "A@Example.COM",
    contactTypePageId: null,
    note: "メモ",
    isActive: true,
    ...over,
  };
}

describe("contact input_hash", () => {
  it("sanitizeは氏名必須", () => {
    expect(() => sanitizeContactWriteInput(sample({ name: "  " }))).toThrow(
      /氏名/,
    );
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeContactWriteInput(
      sample({
        nameKana: "  ",
        department: "",
        title: "  ",
        phone: "",
        email: "  ",
        note: "",
      }),
    );
    expect(sanitized.nameKana).toBeNull();
    expect(sanitized.department).toBeNull();
    expect(sanitized.title).toBeNull();
    expect(sanitized.phone).toBeNull();
    expect(sanitized.email).toBeNull();
    expect(sanitized.note).toBeNull();
  });

  it("canonicalizeでemailを小文字化する", () => {
    const canonical = canonicalizeContactWriteInput(sample());
    expect(canonical.email).toBe("a@example.com");
  });

  it("phoneはハッシュ用に数字のみへ正規化する", () => {
    const a = hashContactWriteInput(sample({ phone: "03-1234-5678" }));
    const b = hashContactWriteInput(sample({ phone: "0312345678" }));
    expect(a).toBe(b);
    expect(canonicalizeContactWriteInput(sample()).phone).toBe("0312345678");
  });

  it("nameKanaはカタカナ→ひらがなでcanonicalizeする", () => {
    const canonical = canonicalizeContactWriteInput(
      sample({ nameKana: "ヤマダタロウ" }),
    );
    expect(canonical.nameKana).toBe("やまだたろう");
  });

  it("expectedAmountキーは存在しない", () => {
    const canonical = canonicalizeContactWriteInput(sample());
    expect(
      Object.prototype.hasOwnProperty.call(canonical, "expectedAmount"),
    ).toBe(false);
    const sanitized = sanitizeContactWriteInput(sample());
    expect(
      Object.prototype.hasOwnProperty.call(sanitized, "expectedAmount"),
    ).toBe(false);
  });
});

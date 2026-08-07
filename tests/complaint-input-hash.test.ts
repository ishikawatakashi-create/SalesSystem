import { describe, expect, it } from "vitest";

import {
  canonicalizeComplaintWriteInput,
  hashComplaintWriteInput,
  sanitizeComplaintWriteInput,
} from "@/lib/complaints/input-hash";
import type { ComplaintWriteInput } from "@/lib/complaints/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const DEAL = "22222222-2222-4222-8222-000000000001";
const SEV = "11111111-1111-4111-8111-000000000701";
const STATUS = "11111111-1111-4111-8111-000000000801";
const STAFF = "55555555-5555-4555-8555-000000000001";

function sample(over: Partial<ComplaintWriteInput> = {}): ComplaintWriteInput {
  return {
    title: "クレームA",
    customerPageId: CUSTOMER,
    dealPageId: DEAL,
    severityPageId: SEV,
    statusPageId: STATUS,
    staffPageId: STAFF,
    occurredOn: "2026-08-01",
    summary: " 概要 ",
    dueDate: "2026-08-15",
    completedOn: null,
    note: " メモ ",
    content: "内容本文",
    cause: "原因本文",
    response: "対応本文",
    prevention: "防止本文",
    ...over,
  };
}

describe("complaint input_hash", () => {
  it("sanitizeはタイトル・顧客必須", () => {
    expect(() => sanitizeComplaintWriteInput(sample({ title: "  " }))).toThrow(
      /タイトル/,
    );
    expect(() =>
      sanitizeComplaintWriteInput(sample({ customerPageId: "  " })),
    ).toThrow(/顧客/);
  });

  it("summary空なら本文連結の先頭200字を自動設定", () => {
    const sanitized = sanitizeComplaintWriteInput(
      sample({
        summary: null,
        content: "自動要約内容",
        cause: null,
        response: null,
        prevention: null,
      }),
    );
    expect(sanitized.summary).toBe("自動要約内容");
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeComplaintWriteInput(
      sample({
        note: "  ",
        dealPageId: "",
        dueDate: "",
        content: "  ",
        cause: "",
      }),
    );
    expect(sanitized.note).toBeNull();
    expect(sanitized.dealPageId).toBeNull();
    expect(sanitized.dueDate).toBeNull();
    expect(sanitized.content).toBeNull();
    expect(sanitized.cause).toBeNull();
  });

  it("canonicalizeは空白を畳む", () => {
    const canonical = canonicalizeComplaintWriteInput(sample());
    expect(canonical.summary).toBe("概要");
    expect(canonical.note).toBe("メモ");
  });

  it("同一正規形は同じハッシュ", () => {
    const a = hashComplaintWriteInput(sample({ title: "クレームA" }));
    const b = hashComplaintWriteInput(sample({ title: " クレームA " }));
    expect(a).toBe(b);
  });

  it("本文セクションや日付の差はハッシュを変える", () => {
    const base = hashComplaintWriteInput(sample());
    expect(hashComplaintWriteInput(sample({ content: "別内容" }))).not.toBe(
      base,
    );
    expect(
      hashComplaintWriteInput(sample({ occurredOn: "2026-08-02" })),
    ).not.toBe(base);
  });
});

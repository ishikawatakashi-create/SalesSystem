import { describe, expect, it } from "vitest";

import {
  canonicalizeDealWriteInput,
  hashDealWriteInput,
  sanitizeDealWriteInput,
} from "@/lib/deals/input-hash";
import type { DealWriteInput } from "@/lib/deals/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const CONTACT_A = "44444444-4444-4444-8444-000000000001";
const CONTACT_B = "44444444-4444-4444-8444-000000000002";
const STAFF_A = "55555555-5555-4555-8555-000000000001";
const STAFF_B = "55555555-5555-4555-8555-000000000002";

function sample(over: Partial<DealWriteInput> = {}): DealWriteInput {
  return {
    title: "案件A",
    customerPageId: CUSTOMER,
    contactPageIds: [CONTACT_B, CONTACT_A],
    businessCategoryPageId: null,
    productName: " 商材X ",
    stagePageId: null,
    staffPageIds: [STAFF_B, STAFF_A],
    expectedAmount: 1000,
    contractAmount: null,
    probability: 50,
    expectedCloseDate: "2026-09-01",
    contractedAt: null,
    periodStart: null,
    periodEnd: null,
    lostReason: null,
    statusPageId: null,
    note: " メモ ",
    ...over,
  };
}

describe("deal input_hash", () => {
  it("sanitizeは案件名・顧客必須", () => {
    expect(() => sanitizeDealWriteInput(sample({ title: "  " }))).toThrow(
      /案件名/,
    );
    expect(() =>
      sanitizeDealWriteInput(sample({ customerPageId: "  " })),
    ).toThrow(/顧客/);
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeDealWriteInput(
      sample({
        productName: "  ",
        lostReason: "",
        note: "",
        expectedCloseDate: "  ",
      }),
    );
    expect(sanitized.productName).toBeNull();
    expect(sanitized.lostReason).toBeNull();
    expect(sanitized.note).toBeNull();
    expect(sanitized.expectedCloseDate).toBeNull();
  });

  it("canonicalizeはcontact/staffをソートし空白を畳む", () => {
    const canonical = canonicalizeDealWriteInput(sample());
    expect(canonical.contactPageIds).toEqual([CONTACT_A, CONTACT_B]);
    expect(canonical.staffPageIds).toEqual([STAFF_A, STAFF_B]);
    expect(canonical.productName).toBe("商材X");
    expect(canonical.note).toBe("メモ");
  });

  it("同一正規形は同じハッシュ", () => {
    const a = hashDealWriteInput(
      sample({
        contactPageIds: [CONTACT_A, CONTACT_B],
        staffPageIds: [STAFF_A, STAFF_B],
        title: "案件A",
      }),
    );
    const b = hashDealWriteInput(
      sample({
        contactPageIds: [CONTACT_B, CONTACT_A],
        staffPageIds: [STAFF_B, STAFF_A],
        title: " 案件A ",
      }),
    );
    expect(a).toBe(b);
  });

  it("金額や確度の差はハッシュを変える", () => {
    const base = hashDealWriteInput(sample());
    expect(hashDealWriteInput(sample({ expectedAmount: 0 }))).not.toBe(base);
    expect(hashDealWriteInput(sample({ expectedAmount: null }))).not.toBe(
      base,
    );
    expect(hashDealWriteInput(sample({ probability: 51 }))).not.toBe(base);
  });
});

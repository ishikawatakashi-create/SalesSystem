import { describe, expect, it } from "vitest";

import {
  canonicalizeContractWriteInput,
  hashContractWriteInput,
  sanitizeContractWriteInput,
} from "@/lib/contracts/input-hash";
import type { ContractWriteInput } from "@/lib/contracts/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const DEAL = "22222222-2222-4222-8222-000000000001";
const STAFF_A = "55555555-5555-4555-8555-000000000001";
const STAFF_B = "55555555-5555-4555-8555-000000000002";
const TYPE = "11111111-1111-4111-8111-000000000501";
const STATUS = "11111111-1111-4111-8111-000000000601";

function sample(over: Partial<ContractWriteInput> = {}): ContractWriteInput {
  return {
    title: "契約A",
    customerPageId: CUSTOMER,
    dealPageId: DEAL,
    contractTypePageId: TYPE,
    tradeTypePageId: null,
    paymentStatusPageId: null,
    statusPageId: STATUS,
    staffPageIds: [STAFF_B, STAFF_A],
    amount: 100_000,
    contractedAt: "2026-08-01",
    startDate: "2026-08-01",
    endDate: "2027-07-31",
    autoRenew: true,
    billingTerms: " 月末締め ",
    contractUrl: "https://example.com/contract",
    note: " メモ ",
    ...over,
  };
}

describe("contract input_hash", () => {
  it("sanitizeは契約名・顧客必須", () => {
    expect(() => sanitizeContractWriteInput(sample({ title: "  " }))).toThrow(
      /契約名/,
    );
    expect(() =>
      sanitizeContractWriteInput(sample({ customerPageId: "  " })),
    ).toThrow(/顧客/);
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeContractWriteInput(
      sample({
        billingTerms: "  ",
        note: "",
        contractUrl: "",
        dealPageId: "  ",
        contractedAt: "  ",
      }),
    );
    expect(sanitized.billingTerms).toBeNull();
    expect(sanitized.note).toBeNull();
    expect(sanitized.contractUrl).toBeNull();
    expect(sanitized.dealPageId).toBeNull();
    expect(sanitized.contractedAt).toBeNull();
  });

  it("canonicalizeはstaffをソートし空白を畳む", () => {
    const canonical = canonicalizeContractWriteInput(sample());
    expect(canonical.staffPageIds).toEqual([STAFF_A, STAFF_B]);
    expect(canonical.billingTerms).toBe("月末締め");
    expect(canonical.note).toBe("メモ");
  });

  it("同一正規形は同じハッシュ", () => {
    const a = hashContractWriteInput(
      sample({
        staffPageIds: [STAFF_A, STAFF_B],
        title: "契約A",
      }),
    );
    const b = hashContractWriteInput(
      sample({
        staffPageIds: [STAFF_B, STAFF_A],
        title: " 契約A ",
      }),
    );
    expect(a).toBe(b);
  });

  it("金額や自動更新の差はハッシュを変える", () => {
    const base = hashContractWriteInput(sample());
    expect(hashContractWriteInput(sample({ amount: 0 }))).not.toBe(base);
    expect(hashContractWriteInput(sample({ amount: null }))).not.toBe(base);
    expect(hashContractWriteInput(sample({ autoRenew: false }))).not.toBe(
      base,
    );
  });
});

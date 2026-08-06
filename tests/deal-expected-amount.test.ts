import { describe, expect, it } from "vitest";

import {
  computeCustomerExpectedAmountFromDeals,
  CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS,
} from "@/lib/deals/expected-amount";

describe("computeCustomerExpectedAmountFromDeals", () => {
  it("semantic_key は active / on_hold のみ(日本語名では判定しない)", () => {
    expect(CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS).toEqual([
      "active",
      "on_hold",
    ]);
    const sum = computeCustomerExpectedAmountFromDeals([
      { status_semantic: "active", expected_amount: 100 },
      { status_semantic: "on_hold", expected_amount: 50 },
      { status_semantic: "won", expected_amount: 999 },
      { status_semantic: "lost", expected_amount: 888 },
      { status_semantic: "completed", expected_amount: 777 },
      // 日本語表示名が誤って入っても集計対象外
      { status_semantic: "進行中", expected_amount: 1000 },
      { status_semantic: "保留", expected_amount: 2000 },
    ]);
    expect(sum).toBe(150);
  });

  it("null金額は除外し、0は0として加算する", () => {
    expect(
      computeCustomerExpectedAmountFromDeals([
        { status_semantic: "active", expected_amount: null },
        { status_semantic: "active", expected_amount: 0 },
        { status_semantic: "on_hold", expected_amount: 10 },
      ]),
    ).toBe(10);
  });

  it("該当案件なしは 0(null にしない)", () => {
    expect(computeCustomerExpectedAmountFromDeals([])).toBe(0);
    expect(
      computeCustomerExpectedAmountFromDeals([
        { status_semantic: "won", expected_amount: 100 },
        { status_semantic: null, expected_amount: 50 },
      ]),
    ).toBe(0);
  });
});

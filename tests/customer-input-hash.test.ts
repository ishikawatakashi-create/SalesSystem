import { describe, expect, it } from "vitest";

import {
  hashCustomerWriteInput,
  sanitizeCustomerWriteInput,
} from "@/lib/customers/input-hash";
import type { CustomerWriteInput } from "@/lib/customers/types";

function sample(over: Partial<CustomerWriteInput> = {}): CustomerWriteInput {
  return {
    displayName: "株式会社テスト",
    legalName: "株式会社テスト",
    officeName: null,
    postalCode: "100-0001",
    prefecture: "東京都",
    city: "千代田区",
    addressLine: "1-1",
    phone: "03-1234-5678",
    email: "a@example.com",
    representativeName: null,
    website: "https://example.com",
    businessCategoryPageIds: ["b2", "b1"],
    tagPageIds: [],
    salesStatusPageId: "s1",
    acquisitionRoutePageId: null,
    priorityPageId: null,
    staffPageIds: ["u1"],
    relatedAccountPageIds: [],
    expectedAmount: null,
    isArchived: false,
    ...over,
  };
}

describe("input_hash", () => {
  it("同一正規化入力は同一ハッシュ", () => {
    const a = hashCustomerWriteInput(sample());
    const b = hashCustomerWriteInput(
      sample({ phone: "0312345678", businessCategoryPageIds: ["b1", "b2"] }),
    );
    expect(a).toBe(b);
  });

  it("異なる入力は異なるハッシュ", () => {
    const a = hashCustomerWriteInput(sample());
    const b = hashCustomerWriteInput(sample({ displayName: "別会社" }));
    expect(a).not.toBe(b);
  });

  it("空の表示名は拒否", () => {
    expect(() => sanitizeCustomerWriteInput(sample({ displayName: "  " }))).toThrow(
      /表示名/,
    );
  });
});

import { describe, expect, it } from "vitest";

import { formatYen } from "@/features/customers/format";
import {
  DERIVED_CUSTOMER_PROPERTY_NAMES,
  omitDerivedCustomerProperties,
} from "@/lib/sync/customer-diff";

describe("formatYen(見込み金額表示)", () => {
  it("nullは未集計として—を返し、0円と区別する", () => {
    expect(formatYen(null)).toBe("—");
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });
});

describe("omitDerivedCustomerProperties", () => {
  it("見込み金額など導出プロパティを書込payloadから除外する", () => {
    const propertiesByName = {
      表示名: { id: "p_name", type: "title" },
      見込み金額: { id: "p_amount", type: "number" },
      最新対応内容: { id: "p_summary", type: "rich_text" },
    };
    const omitted = omitDerivedCustomerProperties(
      {
        p_name: { title: [] },
        p_amount: { number: 1000 },
        p_summary: { rich_text: [] },
      },
      propertiesByName,
    );
    expect(omitted).toEqual({ p_name: { title: [] } });
    expect(DERIVED_CUSTOMER_PROPERTY_NAMES).toContain("見込み金額");
  });
});

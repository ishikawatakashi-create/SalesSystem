import { describe, expect, it } from "vitest";

import { dealDomainToIndexRow } from "@/lib/deals/index-mapper";
import type { DealDomain } from "@/lib/notion/converters/deal";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000301";

function sampleDeal(over: Partial<DealDomain> = {}): DealDomain {
  return {
    notionPageId: "page-deal-1",
    externalId: "11111111-1111-4111-8111-111111111111",
    inTrash: false,
    title: "案件マッパー",
    customerPageId: CUSTOMER,
    contactPageIds: [],
    businessCategoryPageId: null,
    productName: "商材",
    stagePageId: null,
    staffPageIds: [],
    expectedAmount: 12345,
    contractAmount: null,
    probability: 30,
    expectedCloseDate: "2026-10-01",
    contractedAt: null,
    periodStart: null,
    periodEnd: null,
    nextAction: null,
    nextActionDate: null,
    lostReason: null,
    statusPageId: STATUS,
    note: null,
    ...over,
  };
}

describe("dealDomainToIndexRow", () => {
  it("status_semantic と金額・search_text を写像する", () => {
    const row = dealDomainToIndexRow({
      deal: sampleDeal(),
      staffUserIds: ["user-1"],
      statusSemantic: "active",
      contentHash: "abc",
      notionLastEditedAt: "2026-08-07T00:00:00.000Z",
      syncStatus: "synced",
      customerDisplayName: "テスト顧客",
      contactNames: ["担当A"],
      staffNames: ["社員B"],
      nowIso: "2026-08-07T01:00:00.000Z",
    });
    expect(row.notion_page_id).toBe("page-deal-1");
    expect(row.status_semantic).toBe("active");
    expect(row.expected_amount).toBe(12345);
    expect(row.staff_user_ids).toEqual(["user-1"]);
    expect(row.search_text).toContain("案件マッパー".replace(/\s/g, ""));
    expect(row.search_text.length).toBeGreaterThan(0);
    expect(row.sync_status).toBe("synced");
  });

  it("null金額とnon-aggregating semanticを保持する", () => {
    const row = dealDomainToIndexRow({
      deal: sampleDeal({ expectedAmount: null, statusPageId: null }),
      staffUserIds: [],
      statusSemantic: "won",
      contentHash: "def",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.expected_amount).toBeNull();
    expect(row.status_semantic).toBe("won");
    expect(row.status_id).toBeNull();
  });
});

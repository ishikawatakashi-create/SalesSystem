import { describe, expect, it } from "vitest";

import { contractDomainToIndexRow } from "@/lib/contracts/index-mapper";
import type { ContractDomain } from "@/lib/notion/converters/contract";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000601";

function sampleContract(over: Partial<ContractDomain> = {}): ContractDomain {
  return {
    notionPageId: "page-contract-1",
    externalId: "11111111-1111-4111-8111-111111111111",
    inTrash: false,
    title: "契約マッパー",
    customerPageId: CUSTOMER,
    dealPageId: null,
    contractTypePageId: null,
    tradeTypePageId: null,
    paymentStatusPageId: null,
    statusPageId: STATUS,
    staffPageIds: [],
    amount: 50000,
    contractedAt: "2026-08-01",
    startDate: "2026-08-01",
    endDate: "2027-07-31",
    autoRenew: true,
    billingTerms: "月末",
    contractUrl: "https://example.com/c",
    contractFiles: [],
    hasContractFile: false,
    note: null,
    ...over,
  };
}

describe("contractDomainToIndexRow", () => {
  it("status_semantic と金額・search_text を写像する", () => {
    const row = contractDomainToIndexRow({
      contract: sampleContract(),
      staffUserIds: ["user-1"],
      statusSemantic: "active",
      contentHash: "abc",
      notionLastEditedAt: "2026-08-07T00:00:00.000Z",
      syncStatus: "synced",
      customerDisplayName: "テスト顧客",
      dealTitle: "案件X",
      staffNames: ["社員B"],
      nowIso: "2026-08-07T01:00:00.000Z",
    });
    expect(row.notion_page_id).toBe("page-contract-1");
    expect(row.status_semantic).toBe("active");
    expect(row.amount).toBe(50000);
    expect(row.has_contract_url).toBe(true);
    expect(row.has_contract_file).toBe(false);
    expect(row.staff_user_ids).toEqual(["user-1"]);
    expect(row.search_text).toContain("契約マッパー".replace(/\s/g, ""));
    expect(row.search_text.length).toBeGreaterThan(0);
    expect(row.sync_status).toBe("synced");
  });

  it("null金額とnon-active semanticを保持する", () => {
    const row = contractDomainToIndexRow({
      contract: sampleContract({
        amount: null,
        statusPageId: null,
        contractUrl: null,
      }),
      staffUserIds: [],
      statusSemantic: "expired",
      contentHash: "def",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.amount).toBeNull();
    expect(row.status_semantic).toBe("expired");
    expect(row.status_id).toBeNull();
    expect(row.has_contract_url).toBe(false);
  });
});

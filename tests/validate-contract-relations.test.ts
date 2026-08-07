import { describe, expect, it } from "vitest";

import {
  collectContractRelationIds,
  validateContractRelations,
  type ContractRelationLooseInput,
  type ContractRelationLookupData,
} from "@/lib/contracts/validate-relations";
import { ContractSyncError, isContractSyncError } from "@/lib/sync/errors";

const M = {
  typeActive: "11111111-1111-4111-8111-000000000501",
  typeInactive: "11111111-1111-4111-8111-000000000502",
  trade: "11111111-1111-4111-8111-000000000551",
  paymentActive: "11111111-1111-4111-8111-000000000651",
  paymentInactive: "11111111-1111-4111-8111-000000000652",
  statusActive: "11111111-1111-4111-8111-000000000601",
  statusInactive: "11111111-1111-4111-8111-000000000602",
  wrongType: "11111111-1111-4111-8111-000000000051",
};
const CUST = {
  ok: "33333333-3333-4333-8333-000000000001",
  other: "33333333-3333-4333-8333-000000000002",
  archived: "33333333-3333-4333-8333-000000000003",
};
const DEAL = {
  ok: "22222222-2222-4222-8222-000000000001",
  otherCust: "22222222-2222-4222-8222-000000000002",
};
const STAFF = {
  active: "55555555-5555-4555-8555-000000000001",
  inactive: "55555555-5555-4555-8555-000000000002",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): ContractRelationLookupData {
  return {
    masters: [
      {
        notion_page_id: M.typeActive,
        master_type: "契約区分",
        is_active: true,
      },
      {
        notion_page_id: M.typeInactive,
        master_type: "契約区分",
        is_active: false,
      },
      { notion_page_id: M.trade, master_type: "取引区分", is_active: true },
      {
        notion_page_id: M.paymentActive,
        master_type: "支払状況",
        is_active: true,
      },
      {
        notion_page_id: M.paymentInactive,
        master_type: "支払状況",
        is_active: false,
      },
      {
        notion_page_id: M.statusActive,
        master_type: "契約状態",
        is_active: true,
      },
      {
        notion_page_id: M.statusInactive,
        master_type: "契約状態",
        is_active: false,
      },
      {
        notion_page_id: M.wrongType,
        master_type: "案件ステージ",
        is_active: true,
      },
    ],
    staff: [
      { notion_staff_page_id: STAFF.active, is_active: true },
      { notion_staff_page_id: STAFF.inactive, is_active: false },
    ],
    customers: [
      { notion_page_id: CUST.ok, is_archived: false, sync_status: "synced" },
      { notion_page_id: CUST.other, is_archived: false, sync_status: "synced" },
      {
        notion_page_id: CUST.archived,
        is_archived: true,
        sync_status: "synced",
      },
    ],
    deals: [
      { notion_page_id: DEAL.ok, customer_page_id: CUST.ok },
      { notion_page_id: DEAL.otherCust, customer_page_id: CUST.other },
    ],
  };
}

function input(
  overrides: Partial<ContractRelationLooseInput> = {},
): ContractRelationLooseInput {
  return {
    title: "test_validate_contract",
    customerPageId: CUST.ok,
    dealPageId: null,
    contractTypePageId: M.typeActive,
    tradeTypePageId: null,
    paymentStatusPageId: M.paymentActive,
    statusPageId: M.statusActive,
    staffPageIds: [],
    amount: 1000,
    contractedAt: null,
    startDate: null,
    endDate: null,
    autoRenew: false,
    billingTerms: null,
    contractUrl: null,
    note: null,
    ...overrides,
  };
}

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (isContractSyncError(e)) {
      expect(e.code).toBe("validation");
      return String(e.detail?.reason);
    }
    throw e;
  }
  throw new Error("expected validation error");
}

const emptyCurrent = {
  customerPageId: CUST.ok as string | null,
  dealPageId: null as string | null,
  contractTypePageId: M.typeActive as string | null,
  tradeTypePageId: null as string | null,
  paymentStatusPageId: M.paymentActive as string | null,
  statusPageId: M.statusActive as string | null,
  staffPageIds: [] as string[],
};

describe("validateContractRelations", () => {
  it("有効な顧客+状態+支払を受理する", () => {
    const result = validateContractRelations({
      write: input({
        dealPageId: DEAL.ok,
        staffPageIds: [STAFF.active],
        tradeTypePageId: M.trade,
      }),
      lookup: lookup(),
    });
    expect(result.customerPageId).toBe(CUST.ok);
    expect(result.statusPageId).toBe(M.statusActive);
    expect(result.dealPageId).toBe(DEAL.ok);
  });

  it("存在しない顧客を拒否(invalid_customer_relation)", () => {
    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ customerPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
  });

  it("アーカイブ顧客への新規契約を拒否", () => {
    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      ),
    ).toBe("archived_customer_forbidden");
  });

  it("更新前から維持しているアーカイブ顧客は許可", () => {
    const result = validateContractRelations({
      write: input({ customerPageId: CUST.archived }),
      lookup: lookup(),
      context: {
        current: { ...emptyCurrent, customerPageId: CUST.archived },
      },
    });
    expect(result.customerPageId).toBe(CUST.archived);
  });

  it("別顧客の案件を拒否(deal_customer_mismatch)", () => {
    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ dealPageId: DEAL.otherCust }),
          lookup: lookup(),
        }),
      ),
    ).toBe("deal_customer_mismatch");
  });

  it("新規の無効status/paymentを拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ statusPageId: M.statusInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ paymentStatusPageId: M.paymentInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    const kept = validateContractRelations({
      write: input({
        statusPageId: M.statusInactive,
        paymentStatusPageId: M.paymentInactive,
      }),
      lookup: lookup(),
      context: {
        current: {
          ...emptyCurrent,
          statusPageId: M.statusInactive,
          paymentStatusPageId: M.paymentInactive,
        },
      },
    });
    expect(kept.statusPageId).toBe(M.statusInactive);
    expect(kept.paymentStatusPageId).toBe(M.paymentInactive);
  });

  it("wrong_master_type / invalid_staff / missing customer", () => {
    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ statusPageId: M.wrongType }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");

    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ staffPageIds: [UNKNOWN] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_staff");

    expect(
      reasonOf(() =>
        validateContractRelations({
          write: input({ customerPageId: null }),
          lookup: lookup(),
        }),
      ),
    ).toBe("missing_required_relation");
  });

  it("エラーメッセージにIDを含めない", () => {
    try {
      validateContractRelations({
        write: input({ statusPageId: UNKNOWN }),
        lookup: lookup(),
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractSyncError);
      expect((e as Error).message).not.toContain(UNKNOWN);
    }
  });
});

describe("collectContractRelationIds", () => {
  it("relation IDを重複なしで収集する", () => {
    const ids = collectContractRelationIds(
      input({
        customerPageId: [CUST.ok, CUST.ok],
        statusPageId: [M.statusActive],
        paymentStatusPageId: M.paymentActive,
        dealPageId: DEAL.ok,
        staffPageIds: [STAFF.active, STAFF.active],
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.masterIds.sort()).toEqual(
      [M.typeActive, M.statusActive, M.paymentActive].sort(),
    );
    expect(ids.dealPageIds).toEqual([DEAL.ok]);
    expect(ids.staffPageIds).toEqual([STAFF.active]);
  });
});

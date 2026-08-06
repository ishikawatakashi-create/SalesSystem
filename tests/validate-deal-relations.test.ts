import { describe, expect, it } from "vitest";

import {
  collectDealRelationIds,
  validateDealRelations,
  type DealRelationLooseInput,
  type DealRelationLookupData,
} from "@/lib/deals/validate-relations";
import { DealSyncError, isDealSyncError } from "@/lib/sync/errors";

const M = {
  stageActive: "11111111-1111-4111-8111-000000000201",
  stageInactive: "11111111-1111-4111-8111-000000000202",
  statusActive: "11111111-1111-4111-8111-000000000301",
  statusInactive: "11111111-1111-4111-8111-000000000302",
  category: "11111111-1111-4111-8111-000000000101",
  wrongType: "11111111-1111-4111-8111-000000000051",
};
const CUST = {
  ok: "33333333-3333-4333-8333-000000000001",
  other: "33333333-3333-4333-8333-000000000002",
  archived: "33333333-3333-4333-8333-000000000003",
  deletePending: "33333333-3333-4333-8333-000000000004",
};
const CONTACT = {
  ok: "44444444-4444-4444-8444-000000000001",
  otherCust: "44444444-4444-4444-8444-000000000002",
  inactive: "44444444-4444-4444-8444-000000000003",
};
const STAFF = {
  active: "55555555-5555-4555-8555-000000000001",
  inactive: "55555555-5555-4555-8555-000000000002",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): DealRelationLookupData {
  return {
    masters: [
      {
        notion_page_id: M.stageActive,
        master_type: "案件ステージ",
        is_active: true,
      },
      {
        notion_page_id: M.stageInactive,
        master_type: "案件ステージ",
        is_active: false,
      },
      {
        notion_page_id: M.statusActive,
        master_type: "案件ステータス",
        is_active: true,
      },
      {
        notion_page_id: M.statusInactive,
        master_type: "案件ステータス",
        is_active: false,
      },
      {
        notion_page_id: M.category,
        master_type: "事業区分",
        is_active: true,
      },
      {
        notion_page_id: M.wrongType,
        master_type: "担当者区分",
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
      {
        notion_page_id: CUST.deletePending,
        is_archived: false,
        sync_status: "delete_pending",
      },
    ],
    contacts: [
      {
        notion_page_id: CONTACT.ok,
        customer_page_id: CUST.ok,
        is_active: true,
      },
      {
        notion_page_id: CONTACT.otherCust,
        customer_page_id: CUST.other,
        is_active: true,
      },
      {
        notion_page_id: CONTACT.inactive,
        customer_page_id: CUST.ok,
        is_active: false,
      },
    ],
  };
}

function input(
  overrides: Partial<DealRelationLooseInput> = {},
): DealRelationLooseInput {
  return {
    title: "test_validate_deal",
    customerPageId: CUST.ok,
    contactPageIds: [],
    businessCategoryPageId: null,
    productName: null,
    stagePageId: M.stageActive,
    staffPageIds: [],
    expectedAmount: 1000,
    contractAmount: null,
    probability: null,
    expectedCloseDate: null,
    contractedAt: null,
    periodStart: null,
    periodEnd: null,
    lostReason: null,
    statusPageId: M.statusActive,
    note: null,
    ...overrides,
  };
}

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (isDealSyncError(e)) {
      expect(e.code).toBe("validation");
      return String(e.detail?.reason);
    }
    throw e;
  }
  throw new Error("expected validation error");
}

const emptyCurrent = {
  customerPageId: CUST.ok as string | null,
  contactPageIds: [] as string[],
  businessCategoryPageId: null as string | null,
  stagePageId: M.stageActive as string | null,
  staffPageIds: [] as string[],
  statusPageId: M.statusActive as string | null,
};

describe("validateDealRelations", () => {
  it("有効な顧客+ステージ+ステータスを受理する", () => {
    const result = validateDealRelations({
      write: input({
        contactPageIds: [CONTACT.ok],
        staffPageIds: [STAFF.active],
        businessCategoryPageId: M.category,
      }),
      lookup: lookup(),
    });
    expect(result.customerPageId).toBe(CUST.ok);
    expect(result.stagePageId).toBe(M.stageActive);
    expect(result.statusPageId).toBe(M.statusActive);
    expect(result.contactPageIds).toEqual([CONTACT.ok]);
  });

  it("存在しない顧客を拒否(invalid_customer_relation)", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ customerPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
  });

  it("アーカイブ顧客への新規案件を拒否(archived_customer_forbidden)", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      ),
    ).toBe("archived_customer_forbidden");
  });

  it("更新前から維持しているアーカイブ顧客は許可", () => {
    const result = validateDealRelations({
      write: input({ customerPageId: CUST.archived }),
      lookup: lookup(),
      context: {
        current: { ...emptyCurrent, customerPageId: CUST.archived },
      },
    });
    expect(result.customerPageId).toBe(CUST.archived);
  });

  it("別顧客の担当者を拒否(contact_customer_mismatch)", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ contactPageIds: [CONTACT.otherCust] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("contact_customer_mismatch");
  });

  it("新規の無効contactを拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ contactPageIds: [CONTACT.inactive] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_contact_forbidden");

    const kept = validateDealRelations({
      write: input({ contactPageIds: [CONTACT.inactive] }),
      lookup: lookup(),
      context: {
        current: {
          ...emptyCurrent,
          contactPageIds: [CONTACT.inactive],
        },
      },
    });
    expect(kept.contactPageIds).toEqual([CONTACT.inactive]);
  });

  it("新規の無効stage/statusを拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ stagePageId: M.stageInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ statusPageId: M.statusInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    const kept = validateDealRelations({
      write: input({
        stagePageId: M.stageInactive,
        statusPageId: M.statusInactive,
      }),
      lookup: lookup(),
      context: {
        current: {
          ...emptyCurrent,
          stagePageId: M.stageInactive,
          statusPageId: M.statusInactive,
        },
      },
    });
    expect(kept.stagePageId).toBe(M.stageInactive);
    expect(kept.statusPageId).toBe(M.statusInactive);
  });

  it("wrong_master_type / invalid_staff / missing customer", () => {
    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ stagePageId: M.wrongType }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");

    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ staffPageIds: [UNKNOWN] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_staff");

    expect(
      reasonOf(() =>
        validateDealRelations({
          write: input({ customerPageId: null }),
          lookup: lookup(),
        }),
      ),
    ).toBe("missing_required_relation");
  });

  it("エラーメッセージにIDを含めない", () => {
    try {
      validateDealRelations({
        write: input({ stagePageId: UNKNOWN }),
        lookup: lookup(),
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(DealSyncError);
      expect((e as Error).message).not.toContain(UNKNOWN);
    }
  });
});

describe("collectDealRelationIds", () => {
  it("relation IDを重複なしで収集する", () => {
    const ids = collectDealRelationIds(
      input({
        customerPageId: [CUST.ok, CUST.ok],
        stagePageId: [M.stageActive],
        statusPageId: M.statusActive,
        contactPageIds: [CONTACT.ok, CONTACT.ok],
        staffPageIds: [STAFF.active, STAFF.active],
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.masterIds.sort()).toEqual(
      [M.stageActive, M.statusActive].sort(),
    );
    expect(ids.contactPageIds).toEqual([CONTACT.ok]);
    expect(ids.staffPageIds).toEqual([STAFF.active]);
  });
});

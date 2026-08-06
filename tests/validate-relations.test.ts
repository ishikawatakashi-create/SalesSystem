import { describe, expect, it } from "vitest";

import {
  collectCustomerRelationIds,
  validateCustomerRelations,
  type CustomerRelationLooseInput,
  type RelationLookupData,
} from "@/lib/customers/validate-relations";
import { CustomerSyncError, isCustomerSyncError } from "@/lib/sync/errors";

const M = {
  biz1: "11111111-1111-4111-8111-000000000001",
  biz2: "11111111-1111-4111-8111-000000000002",
  tag1: "11111111-1111-4111-8111-000000000011",
  status1: "11111111-1111-4111-8111-000000000021",
  statusInactive: "11111111-1111-4111-8111-000000000022",
  route1: "11111111-1111-4111-8111-000000000031",
  prio1: "11111111-1111-4111-8111-000000000041",
  dealStage: "11111111-1111-4111-8111-000000000051",
};
const STAFF = {
  active: "22222222-2222-4222-8222-000000000001",
  inactive: "22222222-2222-4222-8222-000000000002",
};
const CUST = {
  self: "33333333-3333-4333-8333-000000000001",
  ok: "33333333-3333-4333-8333-000000000002",
  archived: "33333333-3333-4333-8333-000000000003",
  deletePending: "33333333-3333-4333-8333-000000000004",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): RelationLookupData {
  return {
    masters: [
      { notion_page_id: M.biz1, master_type: "事業区分", is_active: true },
      { notion_page_id: M.biz2, master_type: "事業区分", is_active: true },
      { notion_page_id: M.tag1, master_type: "タグ", is_active: true },
      { notion_page_id: M.status1, master_type: "営業ステータス", is_active: true },
      {
        notion_page_id: M.statusInactive,
        master_type: "営業ステータス",
        is_active: false,
      },
      { notion_page_id: M.route1, master_type: "集客ルート", is_active: true },
      { notion_page_id: M.prio1, master_type: "優先度", is_active: true },
      { notion_page_id: M.dealStage, master_type: "案件ステージ", is_active: true },
    ],
    staff: [
      { notion_staff_page_id: STAFF.active, is_active: true },
      { notion_staff_page_id: STAFF.inactive, is_active: false },
    ],
    relatedCustomers: [
      { notion_page_id: CUST.self, is_archived: false, sync_status: "synced" },
      { notion_page_id: CUST.ok, is_archived: false, sync_status: "synced" },
      { notion_page_id: CUST.archived, is_archived: true, sync_status: "synced" },
      {
        notion_page_id: CUST.deletePending,
        is_archived: false,
        sync_status: "delete_pending",
      },
    ],
  };
}

function input(
  overrides: Partial<CustomerRelationLooseInput> = {},
): CustomerRelationLooseInput {
  return {
    displayName: "test_validate",
    legalName: null,
    officeName: null,
    postalCode: null,
    prefecture: null,
    city: null,
    addressLine: null,
    phone: null,
    email: null,
    representativeName: null,
    website: null,
    businessCategoryPageIds: [],
    tagPageIds: [],
    salesStatusPageId: null,
    acquisitionRoutePageId: null,
    priorityPageId: null,
    staffPageIds: [],
    relatedAccountPageIds: [],
    expectedAmount: null,
    isArchived: false,
    ...overrides,
  };
}

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (isCustomerSyncError(e)) {
      expect(e.code).toBe("validation");
      return String(e.detail?.reason);
    }
    throw e;
  }
  throw new Error("expected validation error");
}

describe("validateCustomerRelations", () => {
  it("正常な各マスタ・staff・関連顧客を受理し正規化して返す", () => {
    const result = validateCustomerRelations({
      write: input({
        businessCategoryPageIds: [M.biz1, M.biz2],
        tagPageIds: [M.tag1],
        salesStatusPageId: M.status1,
        acquisitionRoutePageId: M.route1,
        priorityPageId: M.prio1,
        staffPageIds: [STAFF.active],
        relatedAccountPageIds: [CUST.ok],
      }),
      lookup: lookup(),
    });
    expect(result.salesStatusPageId).toBe(M.status1);
    expect(result.businessCategoryPageIds).toEqual([M.biz1, M.biz2]);
    expect(result.staffPageIds).toEqual([STAFF.active]);
    expect(result.relatedAccountPageIds).toEqual([CUST.ok]);
  });

  it("存在しないマスタIDを拒否(relation_not_found)", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ salesStatusPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("relation_not_found");
  });

  it("別master_typeを拒否(wrong_master_type)", () => {
    // 案件ステージのIDを営業ステータス欄に指定
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ salesStatusPageId: M.dealStage }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");
    // タグ欄に事業区分
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ tagPageIds: [M.biz1] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");
  });

  it("新規指定の無効マスタを拒否(inactive_relation)", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ salesStatusPageId: M.statusInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");
  });

  it("更新前から維持している無効マスタは許可", () => {
    const result = validateCustomerRelations({
      write: input({ salesStatusPageId: M.statusInactive }),
      lookup: lookup(),
      context: {
        current: {
          businessCategoryPageIds: [],
          tagPageIds: [],
          salesStatusPageId: M.statusInactive,
          acquisitionRoutePageId: null,
          priorityPageId: null,
          staffPageIds: [],
          relatedAccountPageIds: [],
        },
      },
    });
    expect(result.salesStatusPageId).toBe(M.statusInactive);
  });

  it("単一relationに複数件を拒否(too_many_relations)", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ salesStatusPageId: [M.status1, M.statusInactive] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("too_many_relations");
  });

  it("単一relationの配列1件は正規化して受理", () => {
    const result = validateCustomerRelations({
      write: input({ priorityPageId: [M.prio1] }),
      lookup: lookup(),
    });
    expect(result.priorityPageId).toBe(M.prio1);
  });

  it("重複IDを正規化(dedupe)する", () => {
    const result = validateCustomerRelations({
      write: input({
        businessCategoryPageIds: [M.biz1, M.biz1, M.biz2],
        staffPageIds: [STAFF.active, STAFF.active],
        relatedAccountPageIds: [CUST.ok, CUST.ok],
        salesStatusPageId: [M.status1, M.status1],
      }),
      lookup: lookup(),
    });
    expect(result.businessCategoryPageIds).toEqual([M.biz1, M.biz2]);
    expect(result.staffPageIds).toEqual([STAFF.active]);
    expect(result.relatedAccountPageIds).toEqual([CUST.ok]);
    expect(result.salesStatusPageId).toBe(M.status1);
  });

  it("有効staffを受理し、不明staffを拒否(invalid_staff)", () => {
    expect(
      validateCustomerRelations({
        write: input({ staffPageIds: [STAFF.active] }),
        lookup: lookup(),
      }).staffPageIds,
    ).toEqual([STAFF.active]);
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ staffPageIds: [UNKNOWN] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_staff");
  });

  it("新規の無効staffを拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ staffPageIds: [STAFF.inactive] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");
    const kept = validateCustomerRelations({
      write: input({ staffPageIds: [STAFF.inactive] }),
      lookup: lookup(),
      context: {
        current: {
          businessCategoryPageIds: [],
          tagPageIds: [],
          salesStatusPageId: null,
          acquisitionRoutePageId: null,
          priorityPageId: null,
          staffPageIds: [STAFF.inactive],
          relatedAccountPageIds: [],
        },
      },
    });
    expect(kept.staffPageIds).toEqual([STAFF.inactive]);
  });

  it("関連顧客の自己参照を拒否(self_reference)", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ relatedAccountPageIds: [CUST.self] }),
          lookup: lookup(),
          context: { selfPageId: CUST.self },
        }),
      ),
    ).toBe("self_reference");
  });

  it("存在しない関連顧客を拒否(invalid_customer_relation)", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ relatedAccountPageIds: [UNKNOWN] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
  });

  it("新規のアーカイブ済み・delete_pending顧客を拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ relatedAccountPageIds: [CUST.archived] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
    expect(
      reasonOf(() =>
        validateCustomerRelations({
          write: input({ relatedAccountPageIds: [CUST.deletePending] }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
    const kept = validateCustomerRelations({
      write: input({ relatedAccountPageIds: [CUST.archived] }),
      lookup: lookup(),
      context: {
        current: {
          businessCategoryPageIds: [],
          tagPageIds: [],
          salesStatusPageId: null,
          acquisitionRoutePageId: null,
          priorityPageId: null,
          staffPageIds: [],
          relatedAccountPageIds: [CUST.archived],
        },
      },
    });
    expect(kept.relatedAccountPageIds).toEqual([CUST.archived]);
  });

  it("エラーメッセージにIDを含めない", () => {
    try {
      validateCustomerRelations({
        write: input({ salesStatusPageId: UNKNOWN }),
        lookup: lookup(),
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(CustomerSyncError);
      expect((e as Error).message).not.toContain(UNKNOWN);
    }
  });
});

describe("collectCustomerRelationIds", () => {
  it("全relation IDを重複なしで収集する", () => {
    const ids = collectCustomerRelationIds(
      input({
        businessCategoryPageIds: [M.biz1, M.biz1],
        tagPageIds: [M.tag1],
        salesStatusPageId: M.status1,
        acquisitionRoutePageId: [M.route1],
        priorityPageId: null,
        staffPageIds: [STAFF.active],
        relatedAccountPageIds: [CUST.ok],
      }),
    );
    expect(ids.masterIds.sort()).toEqual(
      [M.biz1, M.tag1, M.status1, M.route1].sort(),
    );
    expect(ids.staffPageIds).toEqual([STAFF.active]);
    expect(ids.relatedPageIds).toEqual([CUST.ok]);
  });
});

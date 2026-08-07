import { describe, expect, it } from "vitest";

import {
  collectComplaintRelationIds,
  validateComplaintRelations,
  type ComplaintRelationLooseInput,
  type ComplaintRelationLookupData,
} from "@/lib/complaints/validate-relations";
import { ComplaintSyncError, isComplaintSyncError } from "@/lib/sync/errors";

const M = {
  sevActive: "11111111-1111-4111-8111-000000000701",
  sevInactive: "11111111-1111-4111-8111-000000000702",
  statusActive: "11111111-1111-4111-8111-000000000801",
  statusInactive: "11111111-1111-4111-8111-000000000802",
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

function lookup(): ComplaintRelationLookupData {
  return {
    masters: [
      {
        notion_page_id: M.sevActive,
        master_type: "クレーム重要度",
        is_active: true,
      },
      {
        notion_page_id: M.sevInactive,
        master_type: "クレーム重要度",
        is_active: false,
      },
      {
        notion_page_id: M.statusActive,
        master_type: "クレーム対応状況",
        is_active: true,
      },
      {
        notion_page_id: M.statusInactive,
        master_type: "クレーム対応状況",
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
  overrides: Partial<ComplaintRelationLooseInput> = {},
): ComplaintRelationLooseInput {
  return {
    title: "test_validate_complaint",
    customerPageId: CUST.ok,
    dealPageId: null,
    severityPageId: M.sevActive,
    statusPageId: M.statusActive,
    staffPageId: null,
    occurredOn: "2026-08-01",
    summary: "概要",
    dueDate: null,
    completedOn: null,
    note: null,
    content: "内容",
    cause: null,
    response: null,
    prevention: null,
    ...overrides,
  };
}

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (isComplaintSyncError(e)) {
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
  severityPageId: M.sevActive as string | null,
  statusPageId: M.statusActive as string | null,
  staffPageId: null as string | null,
};

describe("validateComplaintRelations", () => {
  it("有効な顧客+重要度+状況を受理する", () => {
    const result = validateComplaintRelations({
      write: input({
        dealPageId: DEAL.ok,
        staffPageId: STAFF.active,
      }),
      lookup: lookup(),
    });
    expect(result.customerPageId).toBe(CUST.ok);
    expect(result.severityPageId).toBe(M.sevActive);
    expect(result.staffPageId).toBe(STAFF.active);
  });

  it("存在しない顧客を拒否", () => {
    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ customerPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
  });

  it("アーカイブ顧客への新規クレームを拒否", () => {
    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      ),
    ).toBe("archived_customer_forbidden");
  });

  it("更新前から維持しているアーカイブ顧客は許可", () => {
    const result = validateComplaintRelations({
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
        validateComplaintRelations({
          write: input({ dealPageId: DEAL.otherCust }),
          lookup: lookup(),
        }),
      ),
    ).toBe("deal_customer_mismatch");
  });

  it("新規の無効severity/status/staffを拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ severityPageId: M.sevInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ statusPageId: M.statusInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ staffPageId: STAFF.inactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    const kept = validateComplaintRelations({
      write: input({
        severityPageId: M.sevInactive,
        statusPageId: M.statusInactive,
        staffPageId: STAFF.inactive,
      }),
      lookup: lookup(),
      context: {
        current: {
          ...emptyCurrent,
          severityPageId: M.sevInactive,
          statusPageId: M.statusInactive,
          staffPageId: STAFF.inactive,
        },
      },
    });
    expect(kept.severityPageId).toBe(M.sevInactive);
    expect(kept.statusPageId).toBe(M.statusInactive);
    expect(kept.staffPageId).toBe(STAFF.inactive);
  });

  it("wrong_master_type / invalid_staff / missing customer", () => {
    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ statusPageId: M.wrongType }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");

    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ staffPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_staff");

    expect(
      reasonOf(() =>
        validateComplaintRelations({
          write: input({ customerPageId: null }),
          lookup: lookup(),
        }),
      ),
    ).toBe("missing_required_relation");
  });

  it("エラーメッセージにIDを含めない", () => {
    try {
      validateComplaintRelations({
        write: input({ severityPageId: UNKNOWN }),
        lookup: lookup(),
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(ComplaintSyncError);
      expect((e as Error).message).not.toContain(UNKNOWN);
    }
  });
});

describe("collectComplaintRelationIds", () => {
  it("relation IDを重複なしで収集する", () => {
    const ids = collectComplaintRelationIds(
      input({
        customerPageId: [CUST.ok, CUST.ok],
        severityPageId: [M.sevActive],
        statusPageId: M.statusActive,
        dealPageId: DEAL.ok,
        staffPageId: STAFF.active,
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.masterIds.sort()).toEqual(
      [M.sevActive, M.statusActive].sort(),
    );
    expect(ids.dealPageIds).toEqual([DEAL.ok]);
    expect(ids.staffPageIds).toEqual([STAFF.active]);
  });
});

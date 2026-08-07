import { describe, expect, it } from "vitest";

import {
  collectActionRelationIds,
  validateActionRelations,
  type ActionRelationLooseInput,
  type ActionRelationLookupData,
} from "@/lib/actions/validate-relations";
import { isActionSyncError } from "@/lib/sync/errors";

const M = {
  open: "11111111-1111-4111-8111-000000000501",
  done: "11111111-1111-4111-8111-000000000502",
  inactive: "11111111-1111-4111-8111-000000000503",
  priority: "11111111-1111-4111-8111-000000000601",
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
const ACTIVITY = {
  ok: "66666666-6666-4666-8666-000000000001",
  otherCust: "66666666-6666-4666-8666-000000000002",
};
const STAFF = {
  active: "55555555-5555-4555-8555-000000000001",
  inactive: "55555555-5555-4555-8555-000000000002",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): ActionRelationLookupData {
  return {
    masters: [
      { notion_page_id: M.open, master_type: "アクション状態", is_active: true },
      { notion_page_id: M.done, master_type: "アクション状態", is_active: true },
      {
        notion_page_id: M.inactive,
        master_type: "アクション状態",
        is_active: false,
      },
      { notion_page_id: M.priority, master_type: "優先度", is_active: true },
      {
        notion_page_id: M.wrongType,
        master_type: "対応履歴分類",
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
    activities: [
      { notion_page_id: ACTIVITY.ok, customer_page_id: CUST.ok },
      { notion_page_id: ACTIVITY.otherCust, customer_page_id: CUST.other },
    ],
  };
}

function input(
  overrides: Partial<ActionRelationLooseInput> = {},
): ActionRelationLooseInput {
  return {
    title: "test_validate_action",
    customerPageId: CUST.ok,
    dealPageId: null,
    activityPageId: null,
    staffPageId: null,
    dueDate: "2026-08-10",
    statusPageId: M.open,
    priorityPageId: null,
    completedAt: null,
    ...overrides,
  };
}

function expectReason(fn: () => unknown, reason: string) {
  try {
    fn();
    expect.fail("should throw");
  } catch (e) {
    expect(isActionSyncError(e)).toBe(true);
    expect((e as { detail?: { reason?: string } }).detail?.reason).toBe(
      reason,
    );
    expect(String((e as Error).message)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  }
}

describe("validateActionRelations", () => {
  it("有効な状態・案件・元対応・担当を受理する", () => {
    const write = validateActionRelations({
      write: input({
        dealPageId: DEAL.ok,
        activityPageId: ACTIVITY.ok,
        staffPageId: STAFF.active,
        priorityPageId: M.priority,
      }),
      lookup: lookup(),
    });
    expect(write.statusPageId).toBe(M.open);
    expect(write.dealPageId).toBe(DEAL.ok);
    expect(write.activityPageId).toBe(ACTIVITY.ok);
    expect(write.staffPageId).toBe(STAFF.active);
  });

  it("別顧客の案件・対応履歴を拒否", () => {
    expectReason(
      () =>
        validateActionRelations({
          write: input({ dealPageId: DEAL.otherCust }),
          lookup: lookup(),
        }),
      "deal_customer_mismatch",
    );
    expectReason(
      () =>
        validateActionRelations({
          write: input({ activityPageId: ACTIVITY.otherCust }),
          lookup: lookup(),
        }),
      "activity_customer_mismatch",
    );
  });

  it("wrong master typeの状態を拒否", () => {
    expectReason(
      () =>
        validateActionRelations({
          write: input({ statusPageId: M.wrongType }),
          lookup: lookup(),
        }),
      "wrong_master_type",
    );
  });

  it("不明スタッフを拒否", () => {
    expectReason(
      () =>
        validateActionRelations({
          write: input({ staffPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      "invalid_staff",
    );
  });

  it("無効状態の新規指定拒否・維持許可", () => {
    expectReason(
      () =>
        validateActionRelations({
          write: input({ statusPageId: M.inactive }),
          lookup: lookup(),
        }),
      "inactive_relation",
    );
    const write = validateActionRelations({
      write: input({ statusPageId: M.inactive }),
      lookup: lookup(),
      context: {
        current: {
          customerPageId: CUST.ok,
          dealPageId: null,
          activityPageId: null,
          staffPageId: null,
          statusPageId: M.inactive,
          priorityPageId: null,
        },
      },
    });
    expect(write.statusPageId).toBe(M.inactive);
  });

  it("アーカイブ顧客への新規を拒否", () => {
    expectReason(
      () =>
        validateActionRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      "archived_customer_forbidden",
    );
  });

  it("collectActionRelationIdsがIDを集める", () => {
    const ids = collectActionRelationIds(
      input({
        dealPageId: DEAL.ok,
        activityPageId: ACTIVITY.ok,
        staffPageId: STAFF.active,
        priorityPageId: M.priority,
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.dealPageIds).toEqual([DEAL.ok]);
    expect(ids.activityPageIds).toEqual([ACTIVITY.ok]);
    expect(ids.staffPageIds).toEqual([STAFF.active]);
    expect(ids.masterIds).toContain(M.open);
    expect(ids.masterIds).toContain(M.priority);
  });
});

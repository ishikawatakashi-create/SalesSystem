import { describe, expect, it } from "vitest";

import {
  collectActivityRelationIds,
  validateActivityRelations,
  type ActivityRelationLooseInput,
  type ActivityRelationLookupData,
} from "@/lib/activities/validate-relations";
import { isActivitySyncError } from "@/lib/sync/errors";

const M = {
  catActive: "11111111-1111-4111-8111-000000000401",
  catInactive: "11111111-1111-4111-8111-000000000402",
  wrongType: "11111111-1111-4111-8111-000000000051",
};
const CUST = {
  ok: "33333333-3333-4333-8333-000000000001",
  other: "33333333-3333-4333-8333-000000000002",
  archived: "33333333-3333-4333-8333-000000000003",
};
const CONTACT = {
  ok: "44444444-4444-4444-8444-000000000001",
  otherCust: "44444444-4444-4444-8444-000000000002",
  inactive: "44444444-4444-4444-8444-000000000003",
};
const DEAL = {
  ok: "22222222-2222-4222-8222-000000000001",
  otherCust: "22222222-2222-4222-8222-000000000002",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): ActivityRelationLookupData {
  return {
    masters: [
      {
        notion_page_id: M.catActive,
        master_type: "対応履歴分類",
        is_active: true,
      },
      {
        notion_page_id: M.catInactive,
        master_type: "対応履歴分類",
        is_active: false,
      },
      {
        notion_page_id: M.wrongType,
        master_type: "担当者区分",
        is_active: true,
      },
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
    deals: [
      { notion_page_id: DEAL.ok, customer_page_id: CUST.ok },
      { notion_page_id: DEAL.otherCust, customer_page_id: CUST.other },
    ],
  };
}

function input(
  overrides: Partial<ActivityRelationLooseInput> = {},
): ActivityRelationLooseInput {
  return {
    title: "test_validate_activity",
    customerPageId: CUST.ok,
    dealPageId: null,
    contactPageIds: [],
    activityAt: "2026-08-07T10:00:00.000Z",
    categoryPageIds: [],
    summary: null,
    nextActionNote: null,
    nextActionDate: null,
    body: "body",
    batchId: null,
    ...overrides,
  };
}

function expectReason(fn: () => unknown, reason: string) {
  try {
    fn();
    expect.fail("should throw");
  } catch (e) {
    expect(isActivitySyncError(e)).toBe(true);
    expect((e as { detail?: { reason?: string } }).detail?.reason).toBe(
      reason,
    );
    expect(String((e as Error).message)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  }
}

describe("validateActivityRelations", () => {
  it("有効な顧客・分類・担当者・案件を受理する", () => {
    const write = validateActivityRelations({
      write: input({
        dealPageId: DEAL.ok,
        contactPageIds: [CONTACT.ok],
        categoryPageIds: [M.catActive],
      }),
      lookup: lookup(),
    });
    expect(write.customerPageId).toBe(CUST.ok);
    expect(write.dealPageId).toBe(DEAL.ok);
    expect(write.contactPageIds).toEqual([CONTACT.ok]);
    expect(write.categoryPageIds).toEqual([M.catActive]);
  });

  it("存在しない分類を拒否", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ categoryPageIds: [UNKNOWN] }),
          lookup: lookup(),
        }),
      "relation_not_found",
    );
  });

  it("wrong master typeを拒否", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ categoryPageIds: [M.wrongType] }),
          lookup: lookup(),
        }),
      "wrong_master_type",
    );
  });

  it("アーカイブ顧客への新規割当を拒否", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      "archived_customer_forbidden",
    );
  });

  it("既存アーカイブ顧客の維持は許可", () => {
    const write = validateActivityRelations({
      write: input({ customerPageId: CUST.archived }),
      lookup: lookup(),
      context: { current: { customerPageId: CUST.archived, dealPageId: null, contactPageIds: [], categoryPageIds: [] } },
    });
    expect(write.customerPageId).toBe(CUST.archived);
  });

  it("別顧客の担当者を拒否", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ contactPageIds: [CONTACT.otherCust] }),
          lookup: lookup(),
        }),
      "contact_customer_mismatch",
    );
  });

  it("別顧客の案件を拒否", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ dealPageId: DEAL.otherCust }),
          lookup: lookup(),
        }),
      "deal_customer_mismatch",
    );
  });

  it("無効担当者の新規指定を拒否・維持は許可", () => {
    expectReason(
      () =>
        validateActivityRelations({
          write: input({ contactPageIds: [CONTACT.inactive] }),
          lookup: lookup(),
        }),
      "inactive_contact_forbidden",
    );
    const write = validateActivityRelations({
      write: input({ contactPageIds: [CONTACT.inactive] }),
      lookup: lookup(),
      context: {
        current: {
          customerPageId: CUST.ok,
          dealPageId: null,
          contactPageIds: [CONTACT.inactive],
          categoryPageIds: [],
        },
      },
    });
    expect(write.contactPageIds).toEqual([CONTACT.inactive]);
  });

  it("collectActivityRelationIdsがIDを集める", () => {
    const ids = collectActivityRelationIds(
      input({
        dealPageId: DEAL.ok,
        contactPageIds: [CONTACT.ok],
        categoryPageIds: [M.catActive],
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.dealPageIds).toEqual([DEAL.ok]);
    expect(ids.contactPageIds).toEqual([CONTACT.ok]);
    expect(ids.masterIds).toEqual([M.catActive]);
  });
});

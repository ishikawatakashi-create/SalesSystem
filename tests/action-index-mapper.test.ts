import { describe, expect, it } from "vitest";

import { actionDomainToIndexRow } from "@/lib/actions/index-mapper";
import type { ActionDomain } from "@/lib/notion/converters/action";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000501";
const STAFF = "55555555-5555-4555-8555-000000000001";

function sample(over: Partial<ActionDomain> = {}): ActionDomain {
  return {
    notionPageId: "page-action-1",
    externalId: "11111111-1111-4111-8111-111111111111",
    inTrash: false,
    title: "アクションマッパー",
    customerPageId: CUSTOMER,
    dealPageId: null,
    activityPageId: null,
    staffPageId: STAFF,
    dueDate: "2026-08-10",
    statusPageId: STATUS,
    priorityPageId: null,
    completedAt: null,
    createdById: "actor",
    createdByName: "Actor",
    ...over,
  };
}

describe("actionDomainToIndexRow", () => {
  it("semantic open で is_open=true", () => {
    const row = actionDomainToIndexRow({
      action: sample(),
      assigneeUserId: "user-1",
      statusSemantic: "open",
      contentHash: "abc",
      notionLastEditedAt: "2026-08-07T00:00:00.000Z",
      syncStatus: "synced",
      customerDisplayName: "テスト顧客",
      staffName: "社員A",
      nowIso: "2026-08-07T01:00:00.000Z",
    });
    expect(row.is_open).toBe(true);
    expect(row.assignee_user_id).toBe("user-1");
    expect(row.staff_page_id).toBe(STAFF);
    expect(row.search_text.length).toBeGreaterThan(0);
  });

  it("done/cancelled は is_open=false", () => {
    expect(
      actionDomainToIndexRow({
        action: sample(),
        assigneeUserId: null,
        statusSemantic: "done",
        contentHash: "d",
        notionLastEditedAt: null,
        syncStatus: "synced",
      }).is_open,
    ).toBe(false);
    expect(
      actionDomainToIndexRow({
        action: sample(),
        assigneeUserId: null,
        statusSemantic: "cancelled",
        contentHash: "c",
        notionLastEditedAt: null,
        syncStatus: "synced",
      }).is_open,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_LIST_PER_PAGE,
  buildActivityListSearch,
  parseActivityListParams,
} from "@/lib/activities/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const DEAL = "22222222-2222-4222-8222-000000000001";
const CONTACT = "33333333-3333-4333-8333-000000000001";
const CATEGORY = "44444444-4444-4444-8444-000000000001";
const CREATED_BY = "55555555-5555-4555-8555-000000000001";

describe("parseActivityListParams", () => {
  it("既定値: 1ページ目・50件", () => {
    const { query, page } = parseActivityListParams({});
    expect(query.limit).toBe(ACTIVITY_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(page).toBe(1);
  });

  it("フィルターをURLから解析する", () => {
    const { query, page } = parseActivityListParams({
      q: " 対応 ",
      customer: CUSTOMER,
      deal: DEAL,
      contact: CONTACT,
      category: CATEGORY,
      createdBy: CREATED_BY,
      from: "2026-01-01",
      to: "2026-12-31",
      batch: "batch-1",
      sort: "activity_at",
      dir: "desc",
      page: "2",
    });
    expect(query.q).toBe("対応");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.dealPageId).toBe(DEAL);
    expect(query.contactPageId).toBe(CONTACT);
    expect(query.categoryId).toBe(CATEGORY);
    expect(query.createdBy).toBe(CREATED_BY);
    expect(query.activityAtFrom).toBe("2026-01-01");
    expect(query.activityAtTo).toBe("2026-12-31");
    expect(query.batchId).toBe("batch-1");
    expect(query.sort).toBe("activity_at");
    expect(query.sortDir).toBe("desc");
    expect(page).toBe(2);
    expect(query.offset).toBe(ACTIVITY_LIST_PER_PAGE);
  });

  it("不正なUUID・ソートを無視する", () => {
    const { query } = parseActivityListParams({
      customer: "not-uuid",
      sort: "drop table",
      dir: "sideways",
      page: "0",
    });
    expect(query.customerPageId).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.offset).toBe(0);
  });
});

describe("buildActivityListSearch", () => {
  it("既存条件を維持しつつ差し替える", () => {
    const s = buildActivityListSearch(
      { q: "対応", customer: CUSTOMER, page: "2" },
      { deal: DEAL, page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain(`customer=${CUSTOMER}`);
    expect(s).toContain(`deal=${DEAL}`);
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildActivityListSearch(
      { customer: CUSTOMER, page: "2" },
      { page: undefined },
    );
    expect(s).not.toContain("page=");
    expect(s).toContain(`customer=${CUSTOMER}`);
  });
});

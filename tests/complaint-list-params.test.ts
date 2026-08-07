import { describe, expect, it } from "vitest";

import {
  COMPLAINT_LIST_PER_PAGE,
  buildComplaintListSearch,
  parseComplaintListParams,
} from "@/lib/complaints/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const DEAL = "22222222-2222-4222-8222-000000000001";
const SEV = "33333333-3333-4333-8333-000000000001";
const STATUS = "44444444-4444-4444-8444-000000000001";
const STAFF = "55555555-5555-4555-8555-000000000001";

describe("parseComplaintListParams", () => {
  it("既定値: 1ページ目・50件・未解決のみ", () => {
    const { query, page } = parseComplaintListParams({});
    expect(query.limit).toBe(COMPLAINT_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(query.unresolvedOnly).toBe(true);
    expect(page).toBe(1);
  });

  it("フィルターをURLから解析する", () => {
    const { query, page } = parseComplaintListParams({
      q: " クレーム ",
      customer: CUSTOMER,
      deal: DEAL,
      severity: SEV,
      status: STATUS,
      semantic: "open",
      unresolved: "1",
      staff: STAFF,
      occurredFrom: "2026-01-01",
      occurredTo: "2026-12-31",
      dueFrom: "2026-02-01",
      dueTo: "2026-03-01",
      sort: "due_date",
      dir: "asc",
      page: "2",
    });
    expect(query.q).toBe("クレーム");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.dealPageId).toBe(DEAL);
    expect(query.severityId).toBe(SEV);
    expect(query.statusId).toBe(STATUS);
    expect(query.statusSemantic).toBe("open");
    expect(query.unresolvedOnly).toBe(true);
    expect(query.staffUserId).toBe(STAFF);
    expect(query.occurredOnFrom).toBe("2026-01-01");
    expect(query.occurredOnTo).toBe("2026-12-31");
    expect(query.dueDateFrom).toBe("2026-02-01");
    expect(query.dueDateTo).toBe("2026-03-01");
    expect(query.sort).toBe("due_date");
    expect(query.sortDir).toBe("asc");
    expect(page).toBe(2);
    expect(query.offset).toBe(COMPLAINT_LIST_PER_PAGE);
  });

  it("不正な日付・ソート・UUIDを無視する", () => {
    const { query } = parseComplaintListParams({
      occurredFrom: "2026/01/01",
      dueTo: "not-a-date",
      sort: "drop table",
      dir: "sideways",
      customer: "not-uuid",
      page: "0",
    });
    expect(query.occurredOnFrom).toBeUndefined();
    expect(query.dueDateTo).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.customerPageId).toBeUndefined();
    // status/semantic 未指定時は未解決が既定
    expect(query.unresolvedOnly).toBe(true);
    expect(query.offset).toBe(0);
  });

  it("unresolved=0/all で未解決既定を解除する", () => {
    expect(
      parseComplaintListParams({ unresolved: "0" }).query.unresolvedOnly,
    ).toBeUndefined();
    expect(
      parseComplaintListParams({ unresolved: "all" }).query.unresolvedOnly,
    ).toBeUndefined();
    expect(
      parseComplaintListParams({ status: STATUS }).query.unresolvedOnly,
    ).toBeUndefined();
  });
});

describe("buildComplaintListSearch", () => {
  it("既存条件を維持しつつ差し替える", () => {
    const s = buildComplaintListSearch(
      {
        q: "クレーム",
        unresolved: "1",
        occurredFrom: "2026-01-01",
        page: "2",
      },
      { severity: SEV, page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain("unresolved=1");
    expect(s).toContain(`severity=${SEV}`);
    expect(s).toContain("occurredFrom=2026-01-01");
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildComplaintListSearch(
      { unresolved: "1", page: "2" },
      { page: undefined },
    );
    expect(s).not.toContain("page=");
    expect(s).toContain("unresolved=1");
  });
});

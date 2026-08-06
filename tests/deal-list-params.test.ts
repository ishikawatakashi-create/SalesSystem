import { describe, expect, it } from "vitest";

import {
  DEAL_LIST_PER_PAGE,
  buildDealListSearch,
  parseDealListParams,
} from "@/lib/deals/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const STAGE = "22222222-2222-4222-8222-000000000001";
const STATUS = "33333333-3333-4333-8333-000000000001";
const STAFF = "44444444-4444-4444-8444-000000000001";

describe("parseDealListParams", () => {
  it("既定値: 1ページ目・50件", () => {
    const { query, page } = parseDealListParams({});
    expect(query.limit).toBe(DEAL_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(page).toBe(1);
  });

  it("金額・日付フィルターをURLから解析する", () => {
    const { query, page } = parseDealListParams({
      q: " 案件 ",
      customer: CUSTOMER,
      stage: STAGE,
      status: STATUS,
      semantic: "active",
      staff: STAFF,
      amountMin: "1000",
      amountMax: "50000",
      closeFrom: "2026-01-01",
      closeTo: "2026-12-31",
      contractedFrom: "2026-02-01",
      contractedTo: "2026-03-01",
      sort: "expected_amount",
      dir: "desc",
      page: "2",
    });
    expect(query.q).toBe("案件");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.stageId).toBe(STAGE);
    expect(query.statusId).toBe(STATUS);
    expect(query.statusSemantic).toBe("active");
    expect(query.staffUserId).toBe(STAFF);
    expect(query.expectedAmountMin).toBe(1000);
    expect(query.expectedAmountMax).toBe(50000);
    expect(query.expectedCloseDateFrom).toBe("2026-01-01");
    expect(query.expectedCloseDateTo).toBe("2026-12-31");
    expect(query.contractedAtFrom).toBe("2026-02-01");
    expect(query.contractedAtTo).toBe("2026-03-01");
    expect(query.sort).toBe("expected_amount");
    expect(query.sortDir).toBe("desc");
    expect(page).toBe(2);
    expect(query.offset).toBe(DEAL_LIST_PER_PAGE);
  });

  it("不正な金額・日付・ソートを無視する", () => {
    const { query } = parseDealListParams({
      amountMin: "-1",
      amountMax: "1.5",
      closeFrom: "2026/01/01",
      closeTo: "not-a-date",
      sort: "drop table",
      dir: "sideways",
      customer: "not-uuid",
      page: "0",
    });
    expect(query.expectedAmountMin).toBeUndefined();
    expect(query.expectedAmountMax).toBeUndefined();
    expect(query.expectedCloseDateFrom).toBeUndefined();
    expect(query.expectedCloseDateTo).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.customerPageId).toBeUndefined();
    expect(query.offset).toBe(0);
  });
});

describe("buildDealListSearch", () => {
  it("既存条件を維持しつつ金額フィルターを差し替える", () => {
    const s = buildDealListSearch(
      {
        q: "案件",
        amountMin: "1000",
        closeFrom: "2026-01-01",
        page: "2",
      },
      { amountMax: "9000", page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain("amountMin=1000");
    expect(s).toContain("amountMax=9000");
    expect(s).toContain("closeFrom=2026-01-01");
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildDealListSearch(
      { amountMin: "100", page: "2" },
      { page: undefined },
    );
    expect(s).not.toContain("page=");
    expect(s).toContain("amountMin=100");
  });
});

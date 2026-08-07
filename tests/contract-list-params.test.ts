import { describe, expect, it } from "vitest";

import {
  CONTRACT_LIST_PER_PAGE,
  buildContractListSearch,
  parseContractListParams,
} from "@/lib/contracts/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const DEAL = "22222222-2222-4222-8222-000000000001";
const STATUS = "33333333-3333-4333-8333-000000000001";
const PAYMENT = "44444444-4444-4444-8444-000000000001";
const STAFF = "55555555-5555-4555-8555-000000000001";

describe("parseContractListParams", () => {
  it("既定値: 1ページ目・50件", () => {
    const { query, page } = parseContractListParams({});
    expect(query.limit).toBe(CONTRACT_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(page).toBe(1);
  });

  it("フィルターをURLから解析する", () => {
    const { query, page } = parseContractListParams({
      q: " 契約 ",
      customer: CUSTOMER,
      deal: DEAL,
      status: STATUS,
      semantic: "active",
      payment: PAYMENT,
      staff: STAFF,
      endFrom: "2026-01-01",
      endTo: "2026-12-31",
      contractedFrom: "2026-02-01",
      contractedTo: "2026-03-01",
      sort: "amount",
      dir: "desc",
      page: "2",
    });
    expect(query.q).toBe("契約");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.dealPageId).toBe(DEAL);
    expect(query.statusId).toBe(STATUS);
    expect(query.statusSemantic).toBe("active");
    expect(query.paymentStatusId).toBe(PAYMENT);
    expect(query.staffUserId).toBe(STAFF);
    expect(query.endDateFrom).toBe("2026-01-01");
    expect(query.endDateTo).toBe("2026-12-31");
    expect(query.contractedAtFrom).toBe("2026-02-01");
    expect(query.contractedAtTo).toBe("2026-03-01");
    expect(query.sort).toBe("amount");
    expect(query.sortDir).toBe("desc");
    expect(page).toBe(2);
    expect(query.offset).toBe(CONTRACT_LIST_PER_PAGE);
  });

  it("不正な日付・ソート・UUIDを無視する", () => {
    const { query } = parseContractListParams({
      endFrom: "2026/01/01",
      endTo: "not-a-date",
      sort: "drop table",
      dir: "sideways",
      customer: "not-uuid",
      page: "0",
    });
    expect(query.endDateFrom).toBeUndefined();
    expect(query.endDateTo).toBeUndefined();
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.customerPageId).toBeUndefined();
    expect(query.offset).toBe(0);
  });
});

describe("buildContractListSearch", () => {
  it("既存条件を維持しつつ差し替える", () => {
    const s = buildContractListSearch(
      {
        q: "契約",
        semantic: "active",
        endFrom: "2026-01-01",
        page: "2",
      },
      { payment: PAYMENT, page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain("semantic=active");
    expect(s).toContain(`payment=${PAYMENT}`);
    expect(s).toContain("endFrom=2026-01-01");
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildContractListSearch(
      { semantic: "active", page: "2" },
      { page: undefined },
    );
    expect(s).not.toContain("page=");
    expect(s).toContain("semantic=active");
  });
});

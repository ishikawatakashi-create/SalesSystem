import { describe, expect, it } from "vitest";

import {
  CUSTOMER_LIST_PER_PAGE,
  buildListSearch,
  parseCustomerListParams,
} from "@/lib/customers/list-params";

const STATUS = "11111111-1111-4111-8111-000000000021";
const STAFF = "22222222-2222-4222-8222-000000000001";

describe("parseCustomerListParams", () => {
  it("既定値: 非アーカイブ・1ページ目・50件", () => {
    const { query, page } = parseCustomerListParams({});
    expect(query.isArchived).toBe(false);
    expect(query.limit).toBe(CUSTOMER_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(page).toBe(1);
  });

  it("検索・フィルター・ソート・ページングを解析する", () => {
    const { query, page } = parseCustomerListParams({
      q: " 山田 ",
      status: STATUS,
      staff: STAFF,
      pref: "東京都",
      archived: "1",
      sort: "last_activity_at",
      dir: "asc",
      page: "3",
    });
    expect(query.q).toBe("山田");
    expect(query.salesStatusId).toBe(STATUS);
    expect(query.staffUserId).toBe(STAFF);
    expect(query.prefecture).toBe("東京都");
    expect(query.isArchived).toBe(true);
    expect(query.sort).toBe("last_activity_at");
    expect(query.sortDir).toBe("asc");
    expect(page).toBe(3);
    expect(query.offset).toBe(2 * CUSTOMER_LIST_PER_PAGE);
  });

  it("ホワイトリスト外のソートキー・不正IDを無視する", () => {
    const { query } = parseCustomerListParams({
      sort: "search_text; drop table",
      dir: "sideways",
      status: "not-a-uuid",
      staff: "also-bad",
      page: "-5",
    });
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.salesStatusId).toBeUndefined();
    expect(query.staffUserId).toBeUndefined();
    expect(query.offset).toBe(0);
  });
});

describe("buildListSearch", () => {
  it("既存条件を維持しつつ一部を差し替える", () => {
    const s = buildListSearch(
      { q: "山田", status: STATUS, page: "2" },
      { page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain(`status=${STATUS}`);
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildListSearch({ q: "山田", page: "2" }, { page: undefined });
    expect(s).not.toContain("page=");
  });
});

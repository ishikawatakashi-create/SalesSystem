import { describe, expect, it } from "vitest";

import {
  CONTACT_LIST_PER_PAGE,
  buildContactListSearch,
  parseContactListParams,
} from "@/lib/contacts/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const TYPE = "22222222-2222-4222-8222-000000000001";

describe("parseContactListParams", () => {
  it("既定値: 有効のみ・1ページ目・50件", () => {
    const { query, page } = parseContactListParams({});
    expect(query.isActive).toBe(true);
    expect(query.limit).toBe(CONTACT_LIST_PER_PAGE);
    expect(query.offset).toBe(0);
    expect(page).toBe(1);
  });

  it("検索・フィルター・ソート・ページングを解析する", () => {
    const { query, page } = parseContactListParams({
      q: " 山田 ",
      customer: CUSTOMER,
      type: TYPE,
      inactive: "1",
      sort: "name_kana",
      dir: "asc",
      page: "3",
    });
    expect(query.q).toBe("山田");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.contactTypeId).toBe(TYPE);
    expect(query.isActive).toBe(false);
    expect(query.sort).toBe("name_kana");
    expect(query.sortDir).toBe("asc");
    expect(page).toBe(3);
    expect(query.offset).toBe(2 * CONTACT_LIST_PER_PAGE);
  });

  it("ホワイトリスト外のソートキー・不正IDを無視する", () => {
    const { query } = parseContactListParams({
      sort: "search_text; drop table",
      dir: "sideways",
      customer: "not-a-uuid",
      type: "also-bad",
      page: "-5",
    });
    expect(query.sort).toBeUndefined();
    expect(query.sortDir).toBeUndefined();
    expect(query.customerPageId).toBeUndefined();
    expect(query.contactTypeId).toBeUndefined();
    expect(query.offset).toBe(0);
  });
});

describe("buildContactListSearch", () => {
  it("既存条件を維持しつつ一部を差し替える", () => {
    const s = buildContactListSearch(
      { q: "山田", customer: CUSTOMER, page: "2" },
      { page: "3" },
    );
    expect(s).toContain("q=");
    expect(s).toContain(`customer=${CUSTOMER}`);
    expect(s).toContain("page=3");
  });

  it("undefinedでキーを除去する", () => {
    const s = buildContactListSearch(
      { q: "山田", page: "2" },
      { page: undefined },
    );
    expect(s).not.toContain("page=");
  });
});

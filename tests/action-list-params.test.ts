import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/normalize/date-tokyo", () => ({
  todayDateTokyo: () => "2026-08-07",
}));

import {
  ACTION_LIST_PER_PAGE,
  buildActionListSearch,
  parseActionListParams,
} from "@/lib/actions/list-params";

const CUSTOMER = "11111111-1111-4111-8111-000000000021";
const STATUS = "22222222-2222-4222-8222-000000000001";

describe("parseActionListParams", () => {
  it("既定ビューはtoday-overdue(未完了・期限<=今日)", () => {
    const { query, page, view } = parseActionListParams({});
    expect(view).toBe("today-overdue");
    expect(query.isOpen).toBe(true);
    expect(query.dueDateTo).toBe("2026-08-07");
    expect(query.dueDateFrom).toBeUndefined();
    expect(query.sort).toBe("due_date");
    expect(query.sortDir).toBe("asc");
    expect(query.limit).toBe(ACTION_LIST_PER_PAGE);
    expect(page).toBe(1);
  });

  it("upcomingは明日以降の未完了", () => {
    const { query, view } = parseActionListParams({ view: "upcoming" });
    expect(view).toBe("upcoming");
    expect(query.isOpen).toBe(true);
    expect(query.dueDateFrom).toBe("2026-08-08");
    expect(query.dueDateTo).toBeUndefined();
  });

  it("doneはisOpen=false", () => {
    const { query, view } = parseActionListParams({ view: "done" });
    expect(view).toBe("done");
    expect(query.isOpen).toBe(false);
    expect(query.sort).toBe("completed_at");
  });

  it("明示フィルタがあるときはビュー既定を上書きしない", () => {
    const { query } = parseActionListParams({
      view: "today-overdue",
      open: "0",
      dueFrom: "2026-09-01",
    });
    expect(query.isOpen).toBe(false);
    expect(query.dueDateFrom).toBe("2026-09-01");
    expect(query.dueDateTo).toBeUndefined();
  });

  it("フィルターをURLから解析する", () => {
    const { query } = parseActionListParams({
      q: " 電話 ",
      customer: CUSTOMER,
      status: STATUS,
      view: "all",
      open: "1",
      sort: "title",
      dir: "desc",
    });
    expect(query.q).toBe("電話");
    expect(query.customerPageId).toBe(CUSTOMER);
    expect(query.statusId).toBe(STATUS);
    expect(query.isOpen).toBe(true);
    expect(query.sort).toBe("title");
    expect(query.sortDir).toBe("desc");
  });
});

describe("buildActionListSearch", () => {
  it("viewを維持しつつ差し替える", () => {
    const s = buildActionListSearch(
      { view: "upcoming", customer: CUSTOMER },
      { view: "done", page: "2" },
    );
    expect(s).toContain("view=done");
    expect(s).toContain(`customer=${CUSTOMER}`);
    expect(s).toContain("page=2");
  });
});

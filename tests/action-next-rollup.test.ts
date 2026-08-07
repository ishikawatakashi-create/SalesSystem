import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { selectNextOpenAction } from "@/lib/actions/recalculate-next-action";

describe("selectNextOpenAction", () => {
  it("0件・全てclosedならnull", () => {
    expect(selectNextOpenAction([])).toEqual({
      title: null,
      dueDate: null,
      actionPageId: null,
    });
    expect(
      selectNextOpenAction([
        {
          notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "完了済",
          due_date: "2026-08-01",
          is_open: false,
        },
      ]),
    ).toEqual({ title: null, dueDate: null, actionPageId: null });
  });

  it("done/cancelled(is_open=false)を除外し min due_date", () => {
    const selected = selectNextOpenAction([
      {
        notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "完了",
        due_date: "2026-08-01",
        is_open: false,
      },
      {
        notion_page_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "遅い",
        due_date: "2026-08-20",
        is_open: true,
      },
      {
        notion_page_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: "早い",
        due_date: "2026-08-10",
        is_open: true,
      },
    ]);
    expect(selected.title).toBe("早い");
    expect(selected.dueDate).toBe("2026-08-10");
  });

  it("同一期限は notion_page_id asc で tie-break", () => {
    const selected = selectNextOpenAction([
      {
        notion_page_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: "大",
        due_date: "2026-08-10",
        is_open: true,
      },
      {
        notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "小",
        due_date: "2026-08-10",
        is_open: true,
      },
    ]);
    expect(selected.title).toBe("小");
    expect(selected.actionPageId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("due_date null は後ろへ", () => {
    const selected = selectNextOpenAction([
      {
        notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "期限なし",
        due_date: null,
        is_open: true,
      },
      {
        notion_page_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "期限あり",
        due_date: "2026-08-15",
        is_open: true,
      },
    ]);
    expect(selected.title).toBe("期限あり");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { selectLatestActivity } from "@/lib/activities/recalculate-latest-activity";

describe("selectLatestActivity", () => {
  it("0件ならnull", () => {
    expect(selectLatestActivity([])).toEqual({
      summary: null,
      activityAt: null,
      activityPageId: null,
    });
  });

  it("max activity_at を選び、同値は notion_page_id desc", () => {
    const selected = selectLatestActivity([
      {
        notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        summary: "古い",
        activity_at: "2026-08-01T00:00:00.000Z",
      },
      {
        notion_page_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        summary: "同日時・小",
        activity_at: "2026-08-07T10:00:00.000Z",
      },
      {
        notion_page_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        summary: "同日時・大",
        activity_at: "2026-08-07T10:00:00.000Z",
      },
    ]);
    expect(selected.summary).toBe("同日時・大");
    expect(selected.activityPageId).toBe(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
  });

  it("空文字ではなくnullを返す", () => {
    const selected = selectLatestActivity([
      {
        notion_page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        summary: null,
        activity_at: "2026-08-07T00:00:00.000Z",
      },
    ]);
    expect(selected.summary).toBeNull();
    expect(selected.activityAt).toBe("2026-08-07T00:00:00.000Z");
  });
});

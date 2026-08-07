import { describe, expect, it } from "vitest";

import {
  addDaysYmd,
  aggregateTopStaff,
  bucketActionsByDueDate,
  calcOverdueDays,
  formatYen,
  jstToday,
  prioritizeMyActions,
  sumPipelineAmount,
} from "@/lib/mydesk/pure";

describe("jstToday / addDaysYmd", () => {
  it("JST の今日を YYYY-MM-DD で返す", () => {
    expect(jstToday(new Date("2026-08-07T12:00:00+09:00"))).toBe("2026-08-07");
    expect(jstToday(new Date("2026-08-06T23:30:00+09:00"))).toBe("2026-08-06");
  });

  it("日付加算", () => {
    expect(addDaysYmd("2026-08-07", 7)).toBe("2026-08-14");
    expect(addDaysYmd("2026-08-31", 1)).toBe("2026-09-01");
  });
});

describe("calcOverdueDays", () => {
  it("超過日数を計算し今日以降は null", () => {
    expect(calcOverdueDays("2026-08-05", "2026-08-07")).toBe(2);
    expect(calcOverdueDays("2026-08-07", "2026-08-07")).toBeNull();
    expect(calcOverdueDays("2026-08-08", "2026-08-07")).toBeNull();
    expect(calcOverdueDays(null, "2026-08-07")).toBeNull();
  });
});

describe("formatYen", () => {
  it("null は未入力、0 は ¥0", () => {
    expect(formatYen(null)).toBe("未入力");
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });
});

describe("sumPipelineAmount", () => {
  it("null を除外し nullCount を数える。0 は加算", () => {
    expect(
      sumPipelineAmount([
        { expected_amount: 100 },
        { expected_amount: null },
        { expected_amount: 0 },
        { expected_amount: 50 },
      ]),
    ).toEqual({ sum: 150, nullCount: 1 });
  });
});

describe("prioritizeMyActions", () => {
  it("assignee 一致を先に、その後 due_date 昇順", () => {
    const userId = "user-a";
    const sorted = prioritizeMyActions(
      [
        { assigneeUserId: null, dueDate: "2026-08-01", id: "staff-early" },
        { assigneeUserId: userId, dueDate: "2026-08-10", id: "me-late" },
        { assigneeUserId: userId, dueDate: "2026-08-02", id: "me-early" },
        { assigneeUserId: null, dueDate: "2026-08-03", id: "staff-mid" },
      ],
      userId,
    );
    expect(sorted.map((r) => r.id)).toEqual([
      "me-early",
      "me-late",
      "staff-early",
      "staff-mid",
    ]);
  });
});

describe("bucketActionsByDueDate", () => {
  it("overdue / today / upcoming に分割し upcoming は limit", () => {
    const { overdue, todayItems, upcoming } = bucketActionsByDueDate(
      [
        { dueDate: "2026-08-05", id: "o1" },
        { dueDate: "2026-08-07", id: "t1" },
        { dueDate: "2026-08-08", id: "u1" },
        { dueDate: "2026-08-09", id: "u2" },
        { dueDate: "2026-08-10", id: "u3" },
      ],
      "2026-08-07",
      2,
    );
    expect(overdue.map((r) => r.id)).toEqual(["o1"]);
    expect(todayItems.map((r) => r.id)).toEqual(["t1"]);
    expect(upcoming.map((r) => r.id)).toEqual(["u1", "u2"]);
  });
});

describe("aggregateTopStaff", () => {
  it("先頭 staff_user_id で集計", () => {
    const top = aggregateTopStaff(
      [["a", "b"], ["a"], [], ["c"], ["a"]],
      2,
    );
    expect(top).toEqual([
      { userId: "a", count: 3 },
      { userId: "c", count: 1 },
    ]);
  });
});

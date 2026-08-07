import { describe, expect, it } from "vitest";

import {
  ACTION_CANCELLED_SEMANTIC,
  ACTION_DONE_SEMANTIC,
  ACTION_OPEN_SEMANTIC,
  isActionDoneSemantic,
  isActionOpenSemantic,
  isActionTerminalSemantic,
} from "@/lib/actions/types";
import { overdueDaysTokyo, todayDateTokyo } from "@/lib/normalize/date-tokyo";

describe("action status semantic helpers", () => {
  it("open/done/cancelled 定数と判定", () => {
    expect(ACTION_OPEN_SEMANTIC).toBe("open");
    expect(ACTION_DONE_SEMANTIC).toBe("done");
    expect(ACTION_CANCELLED_SEMANTIC).toBe("cancelled");
    expect(isActionOpenSemantic("open")).toBe(true);
    expect(isActionOpenSemantic("done")).toBe(false);
    expect(isActionDoneSemantic("done")).toBe(true);
    expect(isActionDoneSemantic("completed")).toBe(false);
    expect(isActionTerminalSemantic("done")).toBe(true);
    expect(isActionTerminalSemantic("cancelled")).toBe(true);
    expect(isActionTerminalSemantic("open")).toBe(false);
  });

  it("日本語表示名比較を使わない", () => {
    expect(isActionOpenSemantic("未完了")).toBe(false);
    expect(isActionDoneSemantic("完了")).toBe(false);
  });
});

describe("overdueDaysTokyo", () => {
  it("今日より前なら超過日数、今日以降はnull", () => {
    const today = todayDateTokyo(new Date("2026-08-07T12:00:00+09:00"));
    expect(today).toBe("2026-08-07");
    expect(overdueDaysTokyo("2026-08-05", new Date("2026-08-07T12:00:00+09:00"))).toBe(
      2,
    );
    expect(overdueDaysTokyo("2026-08-07", new Date("2026-08-07T12:00:00+09:00"))).toBeNull();
    expect(overdueDaysTokyo("2026-08-08", new Date("2026-08-07T12:00:00+09:00"))).toBeNull();
    expect(overdueDaysTokyo(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  shouldSubmitOnEnter,
  titleFromActivityBody,
} from "@/lib/activities/quick-title";

describe("titleFromActivityBody", () => {
  it("最初の非空行をタイトルにする", () => {
    expect(
      titleFromActivityBody("電話にて導入時期を確認。9月頃を予定。"),
    ).toBe("電話にて導入時期を確認。9月頃を予定。");
  });

  it("先頭の空行をスキップする", () => {
    expect(titleFromActivityBody("\n\n  連絡済み  \n続き")).toBe("連絡済み");
  });

  it("空本文は既定タイトル", () => {
    expect(titleFromActivityBody("")).toBe("対応メモ");
    expect(titleFromActivityBody("   \n  ")).toBe("対応メモ");
  });

  it("長文は truncate して末尾に…", () => {
    const body = "あ".repeat(60);
    const title = titleFromActivityBody(body, 50);
    expect(title.length).toBe(50);
    expect(title.endsWith("…")).toBe(true);
    expect(title.slice(0, 49)).toBe("あ".repeat(49));
  });

  it("行内の連続空白を正規化する", () => {
    expect(titleFromActivityBody("電話  にて\t確認")).toBe("電話 にて 確認");
  });
});

describe("shouldSubmitOnEnter", () => {
  it("Enter のみで true", () => {
    expect(
      shouldSubmitOnEnter({ key: "Enter", shiftKey: false }),
    ).toBe(true);
  });

  it("Shift+Enter は改行のため false", () => {
    expect(
      shouldSubmitOnEnter({ key: "Enter", shiftKey: true }),
    ).toBe(false);
  });

  it("Enter 以外は false", () => {
    expect(
      shouldSubmitOnEnter({ key: "a", shiftKey: false }),
    ).toBe(false);
  });

  it("IME 変換中(isComposing)は false", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("nativeEvent.isComposing でも false", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
  });

  it("IME 確定 Enter(keyCode 229)は false", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { keyCode: 229 },
      }),
    ).toBe(false);
  });
});

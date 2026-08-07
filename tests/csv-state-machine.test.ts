import { describe, expect, it } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminalStatus,
  canRetry,
} from "@/lib/csv/state-machine";

describe("canTransition", () => {
  it("有効な遷移を許可する", () => {
    expect(canTransition("uploaded", "parsing")).toBe(true);
    expect(canTransition("parsing", "mapping_required")).toBe(true);
    expect(canTransition("mapping_required", "validating")).toBe(true);
    expect(canTransition("validating", "ready")).toBe(true);
    expect(canTransition("ready", "importing")).toBe(true);
    expect(canTransition("importing", "completed")).toBe(true);
  });

  it("完了状態からの遷移を拒否する", () => {
    expect(canTransition("completed", "importing")).toBe(false);
    expect(canTransition("completed", "failed")).toBe(false);
  });

  it("キャンセル状態からの遷移を拒否する", () => {
    expect(canTransition("cancelled", "importing")).toBe(false);
    expect(canTransition("cancelled", "ready")).toBe(false);
  });

  it("失敗状態からの再実行を許可する", () => {
    expect(canTransition("failed", "importing")).toBe(true);
  });

  it("部分完了状態からの再実行を許可する", () => {
    expect(canTransition("partially_completed", "importing")).toBe(true);
  });

  it("任意の状態からキャンセルへの遷移を許可する（完了・キャンセル以外）", () => {
    expect(canTransition("uploaded", "cancelled")).toBe(true);
    expect(canTransition("parsing", "cancelled")).toBe(true);
    expect(canTransition("ready", "cancelled")).toBe(true);
    expect(canTransition("importing", "cancelled")).toBe(true);
  });
});

describe("assertTransition", () => {
  it("有効な遷移では例外を投げない", () => {
    expect(() => assertTransition("uploaded", "parsing")).not.toThrow();
    expect(() => assertTransition("ready", "importing")).not.toThrow();
  });

  it("無効な遷移では例外を投げる", () => {
    expect(() => assertTransition("completed", "importing")).toThrow(
      /無効なステータス遷移/,
    );
    expect(() => assertTransition("cancelled", "ready")).toThrow(
      /無効なステータス遷移/,
    );
  });
});

describe("isTerminalStatus", () => {
  it("終了状態を正しく判定する", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);

    expect(isTerminalStatus("failed")).toBe(false);
    expect(isTerminalStatus("importing")).toBe(false);
  });
});

describe("canRetry", () => {
  it("再実行可能な状態を正しく判定する", () => {
    expect(canRetry("failed")).toBe(true);
    expect(canRetry("partially_completed")).toBe(true);

    expect(canRetry("completed")).toBe(false);
    expect(canRetry("cancelled")).toBe(false);
    expect(canRetry("importing")).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/features/prospects/bulk-assign-panel.tsx"),
  "utf8",
);

describe("prospect bulk assignment safeguards", () => {
  it("groups the assignment-mode radios for keyboard operation", () => {
    expect(source.match(/name="bulk-assignment-mode"/g)).toHaveLength(2);
    expect(source).toContain("<fieldset");
    expect(source).toContain("<legend");
  });

  it("warns and confirms before overwriting existing assignees", () => {
    expect(source).toContain("既に割り当てられている自社担当者も変更します");
    expect(source).toContain("window.confirm(");
    expect(source).toContain("既存担当者を上書きして実行");
  });

  it("uses an immediate ref lock in addition to transition pending state", () => {
    expect(source).toContain("if (submittingRef.current) return");
    expect(source).toContain("submittingRef.current = true");
    expect(source).toContain("submittingRef.current = false");
  });

  it("limits single mode to exactly one assignee in the UI and server paths", () => {
    const actionSource = readFileSync(
      resolve(process.cwd(), "src/features/prospects/actions.ts"),
      "utf8",
    );
    const membershipSource = readFileSync(
      resolve(process.cwd(), "src/lib/prospects/memberships.ts"),
      "utf8",
    );

    expect(source).toContain('multiple={mode === "equal"}');
    expect(source).toContain('(mode === "single" && selected.length !== 1)');
    expect(actionSource).toContain(
      'input.mode === "single" && input.assigneeUserIds.length !== 1',
    );
    expect(membershipSource).toContain(
      'input.mode === "single" && input.assigneeUserIds.length !== 1',
    );
  });
});

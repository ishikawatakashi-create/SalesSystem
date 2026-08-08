import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { INQUIRY_STATUS_LABELS } from "@/lib/inquiries/types";

describe("inquiry list inline controls", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/features/inquiries/inquiry-list-controls.tsx"),
    "utf8",
  );
  const actions = readFileSync(
    resolve(process.cwd(), "src/features/inquiries/actions.ts"),
    "utf8",
  );

  it("既存 Server Action と inquiry.edit を使う", () => {
    expect(src).toContain("assignInquiryAction");
    expect(src).toContain("setInquiryStatusAction");
    expect(src).toContain("stopPropagation");
    expect(src).toContain("保存中");
    expect(actions).toContain('requirePermission(user, "inquiry.edit")');
    expect(actions).toContain('action: "inquiry.assigned"');
    expect(actions).toContain('action: "inquiry.status_changed"');
  });

  it("日本語状態ラベルを維持", () => {
    expect(INQUIRY_STATUS_LABELS.new).toBe("未確認");
    expect(INQUIRY_STATUS_LABELS.in_progress).toBe("対応中");
    expect(INQUIRY_STATUS_LABELS.done).toBe("対応済");
    expect(INQUIRY_STATUS_LABELS.no_action).toBe("対応不要");
  });

  it("対応不要は理由 dialog", () => {
    expect(src).toContain("noActionOpen");
    expect(src).toContain("対応不要にする理由");
  });

  it("失敗時 rollback パターン", () => {
    expect(src).toContain("setAssignee(prev)");
    expect(src).toContain("setCurrentStatus(prev)");
  });

  it("new 割当で in_progress 既存ルールを維持", () => {
    expect(actions).toMatch(
      /if \(input\.userId && before\.status === "new"\)[\s\S]*nextStatus = "in_progress"/,
    );
  });
});

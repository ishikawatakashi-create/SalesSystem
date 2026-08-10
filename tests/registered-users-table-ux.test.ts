import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getUserTableContainerClass,
  getUserTableHeaderClass,
  shouldScrollUserTable,
  USER_TABLE_SCROLL_THRESHOLD,
} from "@/features/admin/users/registered-users-table-layout";

describe("registered users table layout", () => {
  it("1〜10件では内容に合わせて伸びる", () => {
    expect(USER_TABLE_SCROLL_THRESHOLD).toBe(10);
    expect(shouldScrollUserTable(1)).toBe(false);
    expect(shouldScrollUserTable(2)).toBe(false);
    expect(shouldScrollUserTable(10)).toBe(false);
    expect(getUserTableContainerClass({ nested: false, userCount: 10 })).toContain(
      "overflow-x-auto",
    );
  });

  it("11件以上では約10行分を上限に内部スクロールする", () => {
    expect(shouldScrollUserTable(11)).toBe(true);
    expect(shouldScrollUserTable(15)).toBe(true);
    expect(getUserTableContainerClass({ nested: false, userCount: 11 })).toContain(
      "max-h-[min(29rem,calc(100vh-12rem))] overflow-auto",
    );
  });

  it("内部スクロール時だけheaderをstickyにする", () => {
    expect(getUserTableHeaderClass(10)).not.toContain("sticky");
    expect(getUserTableHeaderClass(11)).toContain("sticky top-0 z-10");
  });
});

describe("registered user action menu contract", () => {
  const source = readFileSync(
    resolve("src/features/admin/users/registered-users-table.tsx"),
    "utf8",
  );

  it("native auto popoverでoutside click・Escape・single-openを委譲する", () => {
    expect(source).toContain('popover="auto"');
    expect(source).toContain("popoverTarget={menuId}");
    expect(source).not.toContain("document.addEventListener");
  });

  it("popoverをtriggerの左へ出し、別rowの操作ボタンを覆わない", () => {
    expect(source).toContain('top: "anchor(top)"');
    expect(source).toContain('right: "anchor(left)"');
  });

  it("menu項目はdialog/actionへ進む前にpopoverを閉じる", () => {
    expect(source).toMatch(/closeMenu\(\);\s+setRole/);
    expect(source).toMatch(/closeMenu\(\);\s+setModal\("password"\)/);
    expect(source).toMatch(/function prepareDisable\(\): void \{\s+closeMenu\(\)/);
    expect(source).toMatch(/function reactivate\(\): void \{\s+closeMenu\(\)/);
  });
});

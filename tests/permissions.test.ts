import { describe, expect, it } from "vitest";
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import type { AppRole } from "@/types/database";

const ALL_ROLES: AppRole[] = ["admin", "a", "b", "viewer"];

describe("権限マトリクス(docs/permissions.mdと一致すること)", () => {
  it("adminはすべての操作が可能", () => {
    for (const action of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(hasPermission("admin", action)).toBe(true);
    }
  });

  it("viewerは閲覧のみ可能(書込・管理系はすべて不可)", () => {
    expect(hasPermission("viewer", "customer.view")).toBe(true);
    expect(hasPermission("viewer", "inquiry.view")).toBe(true);
    expect(hasPermission("viewer", "prospect.view")).toBe(true);
    for (const action of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      if (
        action === "customer.view" ||
        action === "inquiry.view" ||
        action === "prospect.view"
      ) {
        continue;
      }
      expect(hasPermission("viewer", action), `viewerは${action}不可のはず`).toBe(
        false,
      );
    }
  });

  it("Prospect権限: viewは全ロール、editはadmin/a/b、import/assign/listsはadmin/a", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "prospect.view")).toBe(true);
    }
    expect(hasPermission("b", "prospect.edit")).toBe(true);
    expect(hasPermission("viewer", "prospect.edit")).toBe(false);
    expect(hasPermission("a", "prospect.import")).toBe(true);
    expect(hasPermission("b", "prospect.import")).toBe(false);
    expect(hasPermission("a", "prospect.assign")).toBe(true);
    expect(hasPermission("b", "prospect.assign")).toBe(false);
    expect(hasPermission("a", "prospect.manage_lists")).toBe(true);
    expect(hasPermission("b", "prospect.manage_lists")).toBe(false);
  });

  it("お問い合わせは閲覧が全ロール、編集はadmin/a/b", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "inquiry.view")).toBe(true);
    }
    expect(hasPermission("admin", "inquiry.edit")).toBe(true);
    expect(hasPermission("a", "inquiry.edit")).toBe(true);
    expect(hasPermission("b", "inquiry.edit")).toBe(true);
    expect(hasPermission("viewer", "inquiry.edit")).toBe(false);
  });

  it("次回アクションの登録・編集はadmin/a/bのみ可能で、viewerは不可", () => {
    expect(hasPermission("admin", "action.edit")).toBe(true);
    expect(hasPermission("a", "action.edit")).toBe(true);
    expect(hasPermission("b", "action.edit")).toBe(true);
    expect(hasPermission("viewer", "action.edit")).toBe(false);
  });

  it("営業Bは記録中心(一括更新・CSV・監査ログ・管理系は不可)", () => {
    expect(hasPermission("b", "customer.edit")).toBe(true);
    expect(hasPermission("b", "activity.edit")).toBe(true);
    expect(hasPermission("b", "bulk.update")).toBe(false);
    expect(hasPermission("b", "csv.import")).toBe(false);
    expect(hasPermission("b", "csv.export")).toBe(false);
    expect(hasPermission("b", "audit.view")).toBe(false);
    expect(hasPermission("b", "user.manage")).toBe(false);
    expect(hasPermission("b", "master.manage")).toBe(false);
  });

  it("ユーザー管理・マスタ管理・同期管理・設定はadminのみ", () => {
    for (const action of [
      "user.manage",
      "master.manage",
      "sync.manage",
      "settings.manage",
    ] as const) {
      for (const role of ALL_ROLES) {
        expect(hasPermission(role, action)).toBe(role === "admin");
      }
    }
  });
});

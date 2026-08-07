import { describe, expect, it } from "vitest";

import { resolveNavGroup } from "@/components/layout/nav-active";

describe("resolveNavGroup", () => {
  it("ルートと空はマイデスク", () => {
    expect(resolveNavGroup("/")).toBe("mydesk");
    expect(resolveNavGroup("")).toBe("mydesk");
  });

  it("顧客・担当者は customers", () => {
    expect(resolveNavGroup("/customers")).toBe("customers");
    expect(resolveNavGroup("/customers/abc")).toBe("customers");
    expect(resolveNavGroup("/contacts")).toBe("customers");
    expect(resolveNavGroup("/contacts/xyz/edit")).toBe("customers");
  });

  it("案件は deals", () => {
    expect(resolveNavGroup("/deals")).toBe("deals");
    expect(resolveNavGroup("/deals/abc")).toBe("deals");
  });

  it("対応履歴・次回アクション・お問い合わせは activities", () => {
    expect(resolveNavGroup("/activities")).toBe("activities");
    expect(resolveNavGroup("/activities/new")).toBe("activities");
    expect(resolveNavGroup("/actions")).toBe("activities");
    expect(resolveNavGroup("/actions/abc")).toBe("activities");
    expect(resolveNavGroup("/inquiries")).toBe("activities");
    expect(resolveNavGroup("/inquiries/abc")).toBe("activities");
  });

  it("契約・クレームは contracts", () => {
    expect(resolveNavGroup("/contracts")).toBe("contracts");
    expect(resolveNavGroup("/contracts/abc")).toBe("contracts");
    expect(resolveNavGroup("/complaints")).toBe("contracts");
    expect(resolveNavGroup("/complaints/abc")).toBe("contracts");
  });

  it("管理は admin", () => {
    expect(resolveNavGroup("/admin")).toBe("admin");
    expect(resolveNavGroup("/admin/users")).toBe("admin");
    expect(resolveNavGroup("/admin/imports")).toBe("admin");
    expect(resolveNavGroup("/admin/sync")).toBe("admin");
  });

  it("検索や未知パスは null", () => {
    expect(resolveNavGroup("/search")).toBeNull();
    expect(resolveNavGroup("/login")).toBeNull();
    expect(resolveNavGroup("/unknown")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolveMasterByDisplayName } from "@/lib/csv/master-resolve";

describe("resolveMasterByDisplayName", () => {
  const masters = [
    {
      notion_page_id: "page-1",
      name: "営業部",
      master_type: "department",
      is_active: true,
      semantic_key: "sales",
    },
    {
      notion_page_id: "page-2",
      name: "技術部",
      master_type: "department",
      is_active: true,
      semantic_key: "engineering",
    },
    {
      notion_page_id: "page-3",
      name: "営業部",
      master_type: "department",
      is_active: false, // 非アクティブ
      semantic_key: "sales-old",
    },
    {
      notion_page_id: "page-4",
      name: "製造業",
      master_type: "industry",
      is_active: true,
      semantic_key: null,
    },
  ];

  it("表示名で正しくマスタを解決できる", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "department",
      displayName: "営業部",
    });

    expect(result).toHaveProperty("pageId", "page-1");
  });

  it("大文字小文字と空白を正規化して一致する", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "department",
      displayName: "  営業部  ",
    });

    expect(result).toHaveProperty("pageId", "page-1");
  });

  it("semantic_key で優先的に解決できる", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "department",
      displayName: "営業部",
      aliases: { 営業部: "sales" },
    });

    expect(result).toHaveProperty("pageId", "page-1");
  });

  it("マスタ種別でフィルタされる", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "industry",
      displayName: "製造業",
    });

    expect(result).toHaveProperty("pageId", "page-4");
  });

  it("マッチしない場合は not_found を返す", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "department",
      displayName: "存在しない部署",
    });

    expect(result).toHaveProperty("error", "not_found");
  });

  it("非アクティブなマスタにマッチする場合は inactive を返す", () => {
    // 非アクティブな「営業部」のみにマッチするケースを作る
    const inactiveMasters = [
      {
        notion_page_id: "page-3",
        name: "営業部",
        master_type: "department",
        is_active: false,
        semantic_key: "sales-old",
      },
    ];

    const result = resolveMasterByDisplayName({
      masters: inactiveMasters,
      masterType: "department",
      displayName: "営業部",
    });

    expect(result).toHaveProperty("error", "inactive");
  });

  it("複数のアクティブなマスタにマッチする場合は ambiguous を返す", () => {
    const ambiguousMasters = [
      {
        notion_page_id: "page-5",
        name: "営業部",
        master_type: "department",
        is_active: true,
        semantic_key: "sales-1",
      },
      {
        notion_page_id: "page-6",
        name: "営業部",
        master_type: "department",
        is_active: true,
        semantic_key: "sales-2",
      },
    ];

    const result = resolveMasterByDisplayName({
      masters: ambiguousMasters,
      masterType: "department",
      displayName: "営業部",
    });

    expect(result).toHaveProperty("error", "ambiguous");
  });

  it("空の表示名は not_found を返す", () => {
    const result = resolveMasterByDisplayName({
      masters,
      masterType: "department",
      displayName: "",
    });

    expect(result).toHaveProperty("error", "not_found");
  });
});

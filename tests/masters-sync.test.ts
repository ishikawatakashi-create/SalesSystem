import { describe, expect, it, vi } from "vitest";
import type { Client } from "@notionhq/client";

import {
  extractMastersPropertyMap,
  notionMasterPageToCacheRow,
  syncMastersCache,
  type MastersCacheUpsertRow,
} from "@/lib/masters/sync-core";

const PROPS = {
  名称: { id: "p_title", name: "名称", type: "title" },
  external_id: { id: "p_ext", name: "external_id", type: "rich_text" },
  マスタ種別: { id: "p_type", name: "マスタ種別", type: "select" },
  semantic_key: { id: "p_sem", name: "semantic_key", type: "rich_text" },
  semantic_tags: { id: "p_tags", name: "semantic_tags", type: "rich_text" },
  表示順: { id: "p_order", name: "表示順", type: "number" },
  色: { id: "p_color", name: "色", type: "select" },
  有効: { id: "p_active", name: "有効", type: "checkbox" },
  備考: { id: "p_note", name: "備考", type: "rich_text" },
  適用事業区分: { id: "p_cat", name: "適用事業区分", type: "relation" },
};

function byName() {
  const map: Record<string, { id: string; type: string }> = {};
  for (const [name, meta] of Object.entries(PROPS)) {
    map[name] = { id: meta.id, type: meta.type };
  }
  return map;
}

function masterPage(input: {
  id: string;
  name: string;
  type: string;
  semanticKey?: string;
  semanticTags?: string;
  order?: number;
  active?: boolean;
  inTrash?: boolean;
}) {
  return {
    id: input.id,
    in_trash: input.inTrash ?? false,
    last_edited_time: "2026-08-06T12:00:00.000Z",
    properties: {
      名称: { id: "p_title", type: "title", title: [{ plain_text: input.name }] },
      external_id: {
        id: "p_ext",
        type: "rich_text",
        rich_text: [{ plain_text: `ext-${input.id}` }],
      },
      マスタ種別: { id: "p_type", type: "select", select: { name: input.type } },
      semantic_key: {
        id: "p_sem",
        type: "rich_text",
        rich_text: input.semanticKey ? [{ plain_text: input.semanticKey }] : [],
      },
      semantic_tags: {
        id: "p_tags",
        type: "rich_text",
        rich_text: input.semanticTags ? [{ plain_text: input.semanticTags }] : [],
      },
      表示順: { id: "p_order", type: "number", number: input.order ?? 10 },
      色: { id: "p_color", type: "select", select: { name: "default" } },
      有効: { id: "p_active", type: "checkbox", checkbox: input.active ?? true },
      適用事業区分: { id: "p_cat", type: "relation", relation: [] },
    },
  };
}

describe("notionMasterPageToCacheRow", () => {
  it("マスタページをcache行へ変換する(semantic_tagsはカンマ区切り→配列)", () => {
    const row = notionMasterPageToCacheRow({
      page: masterPage({
        id: "m1",
        name: "訪問",
        type: "対応履歴分類",
        semanticTags: "meeting,visit",
        order: 30,
      }),
      propertiesByName: byName(),
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    expect(row.notion_page_id).toBe("m1");
    expect(row.master_type).toBe("対応履歴分類");
    expect(row.name).toBe("訪問");
    expect(row.semantic_tags).toEqual(["meeting", "visit"]);
    expect(row.semantic_key).toBeNull();
    expect(row.sort_order).toBe(30);
    expect(row.is_active).toBe(true);
    expect(row.sync_status).toBe("synced");
    expect(row.external_id).toBe("ext-m1");
  });

  it("semantic_keyを取り込む", () => {
    const row = notionMasterPageToCacheRow({
      page: masterPage({
        id: "m2",
        name: "受注",
        type: "営業ステータス",
        semanticKey: "won",
      }),
      propertiesByName: byName(),
    });
    expect(row.semantic_key).toBe("won");
    expect(row.semantic_tags).toEqual([]);
  });

  it("マスタ種別未設定はエラー", () => {
    const page = masterPage({ id: "m3", name: "壊れた", type: "x" });
    (page.properties["マスタ種別"] as { select: unknown }).select = null;
    expect(() =>
      notionMasterPageToCacheRow({ page, propertiesByName: byName() }),
    ).toThrow(/マスタ種別/);
  });
});

describe("syncMastersCache", () => {
  it("ページングで全件upsertし、ゴミ箱はスキップ。再実行しても同一upsert(冪等)", async () => {
    const pages = [
      masterPage({ id: "a1", name: "高", type: "優先度", order: 10 }),
      masterPage({ id: "a2", name: "中", type: "優先度", order: 20 }),
      masterPage({ id: "a3", name: "捨てた", type: "優先度", inTrash: true }),
      masterPage({ id: "a4", name: "低", type: "優先度", order: 30 }),
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        results: pages.slice(0, 2),
        has_more: true,
        next_cursor: "c1",
      })
      .mockResolvedValueOnce({
        results: pages.slice(2),
        has_more: false,
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: pages,
        has_more: false,
        next_cursor: null,
      });
    const notion = { dataSources: { query } } as unknown as Client;

    const upserted: MastersCacheUpsertRow[][] = [];
    const store = {
      upsert: async (rows: MastersCacheUpsertRow[]) => {
        upserted.push(rows);
      },
    };

    const first = await syncMastersCache({
      notion,
      mastersDataSourceId: "ds",
      propertiesByName: byName(),
      store,
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    expect(first.upserted).toBe(3);
    expect(first.skippedInTrash).toBe(1);
    expect(first.byType["優先度"]).toBe(3);

    const second = await syncMastersCache({
      notion,
      mastersDataSourceId: "ds",
      propertiesByName: byName(),
      store,
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    // 冪等: 同じ主キー(notion_page_id)で同内容のupsert。ゴミ箱は常に除外
    expect(second.upserted).toBe(3);
    expect(second.skippedInTrash).toBe(1);
    expect(upserted[1]!.map((r) => r.notion_page_id)).toEqual(
      expect.arrayContaining(["a1", "a2", "a4"]),
    );
    expect(upserted[1]!.map((r) => r.notion_page_id)).not.toContain("a3");
  });
});

describe("extractMastersPropertyMap", () => {
  it("snapshotからmastersプロパティマップを取り出す", () => {
    const map = extractMastersPropertyMap({
      databases: { masters: { properties: PROPS } },
    });
    expect(map["名称"]!.id).toBe("p_title");
  });
  it("mastersがなければエラー", () => {
    expect(() => extractMastersPropertyMap({ databases: {} })).toThrow(
      /masters/,
    );
  });
});

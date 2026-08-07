import { describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_BODY_END_MARKER,
  ACTIVITY_BODY_HEADING,
  buildManagedActivityBodyBlocks,
  collectAllManagedBlockIds,
  extractManagedBody,
  findManagedSections,
  formatActivityBodyVersionMarker,
  hashActivityBody,
  parseActivityBodyVersionMarker,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { replaceManagedActivityBody } from "@/lib/sync/activity-body";
import { isActivitySyncError } from "@/lib/sync/errors";

function para(id: string, text: string): NotionBlockLike {
  return {
    id,
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: text }] },
  };
}

function heading(id: string, text: string): NotionBlockLike {
  return {
    id,
    type: "heading_2",
    heading_2: { rich_text: [{ plain_text: text }] },
  };
}

describe("activity page-body managed section", () => {
  it("marker format/parse", () => {
    expect(formatActivityBodyVersionMarker(2)).toBe("§ss:body_version=2§");
    expect(parseActivityBodyVersionMarker("§ss:body_version=3§")).toBe(3);
    expect(parseActivityBodyVersionMarker("manual note")).toBeNull();
  });

  it("buildManagedActivityBodyBlocks が marker+見出し+本文+endを作る", () => {
    const blocks = buildManagedActivityBodyBlocks({
      body: "一行目\n二行目",
      bodyVersion: 1,
    });
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(blocks[0])).toContain("§ss:body_version=1§");
    expect(JSON.stringify(blocks[1])).toContain(ACTIVITY_BODY_HEADING);
    expect(JSON.stringify(blocks[blocks.length - 1])).toContain(
      ACTIVITY_BODY_END_MARKER,
    );
  });

  it("最高versionを抽出し手動ブロックを管理対象外にする", () => {
    const blocks: NotionBlockLike[] = [
      para("manual-1", "手書きメモ"),
      para("m1", formatActivityBodyVersionMarker(1)),
      heading("h1", ACTIVITY_BODY_HEADING),
      para("b1", "旧本文"),
      para("e1", ACTIVITY_BODY_END_MARKER),
      para("m2", formatActivityBodyVersionMarker(2)),
      heading("h2", ACTIVITY_BODY_HEADING),
      para("b2", "新本文"),
      para("e2", ACTIVITY_BODY_END_MARKER),
      para("manual-2", "もう一つの手書き"),
    ];
    const sections = findManagedSections(blocks);
    expect(sections.map((s) => s.version)).toEqual([1, 2]);
    const latest = extractManagedBody(blocks);
    expect(latest?.bodyVersion).toBe(2);
    expect(latest?.body).toBe("新本文");
    const managedIds = collectAllManagedBlockIds(blocks);
    expect(managedIds).not.toContain("manual-1");
    expect(managedIds).not.toContain("manual-2");
    expect(managedIds).toContain("m2");
    expect(managedIds).toContain("e2");
  });

  it("hashActivityBody は安定", () => {
    expect(hashActivityBody("a")).toBe(hashActivityBody("a"));
    expect(hashActivityBody("a")).not.toBe(hashActivityBody("b"));
  });
});

describe("replaceManagedActivityBody", () => {
  it("append→verify→旧管理のみdeleteし手動ブロックを残す", async () => {
    const store: NotionBlockLike[] = [
      para("old-m", formatActivityBodyVersionMarker(1)),
      heading("old-h", ACTIVITY_BODY_HEADING),
      para("old-b", "旧本文"),
      para("old-e", ACTIVITY_BODY_END_MARKER),
      para("manual-keep", "手書きは残す"),
    ];
    let nextId = 1;
    const deleted: string[] = [];
    const notion = {
      blocks: {
        children: {
          list: vi.fn(async () => ({
            results: store,
            has_more: false,
            next_cursor: null,
          })),
          append: vi.fn(async ({ children }: { children: Array<Record<string, unknown>> }) => {
            const created = children.map((child) => {
              const id = `new-${nextId++}`;
              const type = child.type as string;
              if (type === "paragraph") {
                const text =
                  (
                    child.paragraph as {
                      rich_text?: Array<{ text?: { content?: string } }>;
                    }
                  )?.rich_text?.[0]?.text?.content ?? "";
                const block = para(id, text);
                store.push(block);
                return block;
              }
              if (type === "heading_2") {
                const text =
                  (
                    child.heading_2 as {
                      rich_text?: Array<{ text?: { content?: string } }>;
                    }
                  )?.rich_text?.[0]?.text?.content ?? "";
                const block = heading(id, text);
                store.push(block);
                return block;
              }
              const block = para(id, "");
              store.push(block);
              return block;
            });
            return { results: created };
          }),
        },
        delete: vi.fn(async ({ block_id }: { block_id: string }) => {
          deleted.push(block_id);
          const idx = store.findIndex((b) => b.id === block_id);
          if (idx >= 0) store.splice(idx, 1);
        }),
      },
    };

    const result = await replaceManagedActivityBody({
      notion: notion as never,
      pageId: "page-1",
      body: "更新本文",
      oldContentExpected: true,
    });
    expect(result.bodyVersion).toBe(2);
    expect(store.some((b) => b.id === "manual-keep")).toBe(true);
    expect(deleted).toEqual(
      expect.arrayContaining(["old-m", "old-h", "old-b", "old-e"]),
    );
    expect(deleted).not.toContain("manual-keep");
    const after = extractManagedBody(store);
    expect(after?.body).toBe("更新本文");
  });

  it("管理セクション無しで手動ブロックだけなら安全停止", async () => {
    const notion = {
      blocks: {
        children: {
          list: vi.fn(async () => ({
            results: [para("manual", "手書きのみ")],
            has_more: false,
            next_cursor: null,
          })),
          append: vi.fn(),
        },
        delete: vi.fn(),
      },
    };
    try {
      await replaceManagedActivityBody({
        notion: notion as never,
        pageId: "page-1",
        body: "新本文",
        oldContentExpected: true,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(isActivitySyncError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("ambiguous_write");
    }
    expect(notion.blocks.children.append).not.toHaveBeenCalled();
    expect(notion.blocks.delete).not.toHaveBeenCalled();
  });
});

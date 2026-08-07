import { describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_BODY_END_MARKER,
  COMPLAINT_BODY_HEADINGS,
  buildManagedComplaintBodyBlocks,
  collectAllManagedBlockIds,
  extractManagedComplaintBody,
  findManagedSections,
  formatActivityBodyVersionMarker,
  hashComplaintBody,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { replaceManagedComplaintBody } from "@/lib/sync/complaint-body";
import { isComplaintSyncError } from "@/lib/sync/errors";

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

function managedSection(
  version: number,
  sections: {
    content?: string;
    cause?: string;
    response?: string;
    prevention?: string;
  },
): NotionBlockLike[] {
  const blocks: NotionBlockLike[] = [
    para(`m-${version}`, formatActivityBodyVersionMarker(version)),
  ];
  for (const h of COMPLAINT_BODY_HEADINGS) {
    const key =
      h === "内容"
        ? "content"
        : h === "原因"
          ? "cause"
          : h === "対応内容"
            ? "response"
            : "prevention";
    blocks.push(heading(`h-${version}-${key}`, h));
    blocks.push(para(`b-${version}-${key}`, sections[key] ?? ""));
  }
  blocks.push(para(`e-${version}`, ACTIVITY_BODY_END_MARKER));
  return blocks;
}

describe("complaint page-body managed section", () => {
  it("buildManagedComplaintBodyBlocks が marker+4見出し+endを作る", () => {
    const blocks = buildManagedComplaintBodyBlocks({
      sections: {
        content: "内容本文",
        cause: "原因本文",
        response: "対応本文",
        prevention: "防止本文",
      },
      bodyVersion: 1,
    });
    expect(JSON.stringify(blocks[0])).toContain("§ss:body_version=1§");
    for (const h of COMPLAINT_BODY_HEADINGS) {
      expect(JSON.stringify(blocks)).toContain(h);
    }
    expect(JSON.stringify(blocks[blocks.length - 1])).toContain(
      ACTIVITY_BODY_END_MARKER,
    );
  });

  it("最高versionを抽出し手動ブロックを管理対象外にする", () => {
    const blocks: NotionBlockLike[] = [
      para("manual-1", "手書きメモ"),
      ...managedSection(1, { content: "旧内容" }),
      ...managedSection(2, {
        content: "新内容",
        cause: "新原因",
        response: "新対応",
        prevention: "新防止",
      }),
      para("manual-2", "もう一つの手書き"),
    ];
    const sections = findManagedSections(blocks);
    expect(sections.map((s) => s.version)).toEqual([1, 2]);
    const latest = extractManagedComplaintBody(blocks);
    expect(latest?.bodyVersion).toBe(2);
    expect(latest?.sections.content).toBe("新内容");
    expect(latest?.sections.cause).toBe("新原因");
    const managedIds = collectAllManagedBlockIds(blocks);
    expect(managedIds).not.toContain("manual-1");
    expect(managedIds).not.toContain("manual-2");
    expect(managedIds).toContain("m-2");
    expect(managedIds).toContain("e-2");
  });

  it("hashComplaintBody は安定", () => {
    const a = {
      content: "a",
      cause: null,
      response: null,
      prevention: null,
    };
    const b = {
      content: "b",
      cause: null,
      response: null,
      prevention: null,
    };
    expect(hashComplaintBody(a)).toBe(hashComplaintBody(a));
    expect(hashComplaintBody(a)).not.toBe(hashComplaintBody(b));
  });
});

describe("replaceManagedComplaintBody", () => {
  it("append→verify→旧管理のみdeleteし手動ブロックを残す", async () => {
    const store: NotionBlockLike[] = [
      ...managedSection(1, { content: "旧内容" }),
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
          append: vi.fn(
            async ({ children }: { children: Array<Record<string, unknown>> }) => {
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
            },
          ),
        },
        delete: vi.fn(async ({ block_id }: { block_id: string }) => {
          deleted.push(block_id);
          const idx = store.findIndex((b) => b.id === block_id);
          if (idx >= 0) store.splice(idx, 1);
        }),
      },
    };

    const result = await replaceManagedComplaintBody({
      notion: notion as never,
      pageId: "page-1",
      sections: {
        content: "更新内容",
        cause: "更新原因",
        response: null,
        prevention: null,
      },
      oldContentExpected: true,
    });
    expect(result.bodyVersion).toBe(2);
    expect(store.some((b) => b.id === "manual-keep")).toBe(true);
    expect(deleted).toEqual(expect.arrayContaining(["m-1", "e-1"]));
    expect(deleted).not.toContain("manual-keep");
    const after = extractManagedComplaintBody(store);
    expect(after?.sections.content).toBe("更新内容");
    expect(after?.sections.cause).toBe("更新原因");
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
      await replaceManagedComplaintBody({
        notion: notion as never,
        pageId: "page-1",
        sections: {
          content: "新内容",
          cause: null,
          response: null,
          prevention: null,
        },
        oldContentExpected: true,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(isComplaintSyncError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("ambiguous_write");
    }
    expect(notion.blocks.children.append).not.toHaveBeenCalled();
    expect(notion.blocks.delete).not.toHaveBeenCalled();
  });
});

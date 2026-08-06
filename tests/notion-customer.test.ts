import { describe, expect, it, vi } from "vitest";

import {
  customerToNotionProperties,
  notionPageToCustomer,
} from "@/lib/notion/converters/customer";
import { resolveRelationIds } from "@/lib/notion/converters/relations";
import { staffExternalId } from "@/lib/notion/provisioning/staff-id";
import { buildHeadingSections, summarizeText } from "@/lib/notion/converters/page-body";

const propsByName = {
  表示名: { id: "title", type: "title" },
  external_id: { id: "ext", type: "rich_text" },
  法人名: { id: "legal", type: "rich_text" },
  事業所名: { id: "office", type: "rich_text" },
  郵便番号: { id: "zip", type: "rich_text" },
  都道府県: { id: "pref", type: "select" },
  市区町村: { id: "city", type: "rich_text" },
  住所以降: { id: "addr", type: "rich_text" },
  電話番号: { id: "phone", type: "phone_number" },
  メールアドレス: { id: "mail", type: "email" },
  代表者名: { id: "rep", type: "rich_text" },
  Webサイト: { id: "web", type: "url" },
  事業区分: { id: "cat", type: "relation" },
  タグ: { id: "tag", type: "relation" },
  営業ステータス: { id: "st", type: "relation" },
  集客ルート: { id: "route", type: "relation" },
  優先度: { id: "pri", type: "relation" },
  自社担当者: { id: "staff", type: "relation" },
  関連アカウント: { id: "rel", type: "relation" },
  最新対応内容: { id: "act", type: "rich_text" },
  最終対応日: { id: "lad", type: "date" },
  次回アクション: { id: "na", type: "rich_text" },
  次回予定日: { id: "nad", type: "date" },
  見込み金額: { id: "amt", type: "number" },
  アーカイブ: { id: "arch", type: "checkbox" },
};

describe("顧客コンバーター", () => {
  it("Page→Domain / Domain→properties (property ID)", async () => {
    const page = {
      id: "page1",
      in_trash: false,
      properties: {
        title: { id: "title", type: "title", title: [{ plain_text: "株式会社A" }] },
        ext: {
          id: "ext",
          type: "rich_text",
          rich_text: [{ plain_text: "11111111-1111-4111-8111-111111111111" }],
        },
        legal: { id: "legal", type: "rich_text", rich_text: [] },
        office: { id: "office", type: "rich_text", rich_text: [] },
        zip: { id: "zip", type: "rich_text", rich_text: [] },
        pref: { id: "pref", type: "select", select: { name: "東京都" } },
        city: { id: "city", type: "rich_text", rich_text: [] },
        addr: { id: "addr", type: "rich_text", rich_text: [] },
        phone: { id: "phone", type: "phone_number", phone_number: null },
        mail: { id: "mail", type: "email", email: null },
        rep: { id: "rep", type: "rich_text", rich_text: [] },
        web: { id: "web", type: "url", url: null },
        cat: { id: "cat", type: "relation", relation: [{ id: "c1" }], has_more: false },
        tag: { id: "tag", type: "relation", relation: [], has_more: false },
        st: { id: "st", type: "relation", relation: [], has_more: false },
        route: { id: "route", type: "relation", relation: [], has_more: false },
        pri: { id: "pri", type: "relation", relation: [], has_more: false },
        staff: { id: "staff", type: "relation", relation: [], has_more: false },
        rel: { id: "rel", type: "relation", relation: [], has_more: false },
        act: { id: "act", type: "rich_text", rich_text: [] },
        lad: { id: "lad", type: "date", date: null },
        na: { id: "na", type: "rich_text", rich_text: [] },
        nad: { id: "nad", type: "date", date: null },
        amt: { id: "amt", type: "number", number: 1000 },
        arch: { id: "arch", type: "checkbox", checkbox: false },
      },
    };

    const domain = await notionPageToCustomer({
      page,
      propertiesByName: propsByName,
      pager: { retrieve: async () => ({ type: "relation", relation: [] }) },
    });
    expect(domain.displayName).toBe("株式会社A");
    expect(domain.externalId).toBe("11111111-1111-4111-8111-111111111111");
    expect(domain.businessCategoryPageIds).toEqual(["c1"]);
    expect(domain.inTrash).toBe(false);

    const props = customerToNotionProperties({
      customer: domain,
      propertiesByName: propsByName,
    });
    expect(props.title).toBeTruthy();
    expect(props.ext).toBeTruthy();
  });

  it("25件超relationをページネーションする", async () => {
    const first = Array.from({ length: 25 }, (_, i) => ({ id: `id-${i}` }));
    const pager = {
      retrieve: vi.fn(async ({ start_cursor }: { start_cursor?: string }) => {
        if (start_cursor === "cursor-1") {
          return {
            type: "relation",
            relation: [{ id: "id-25" }, { id: "id-26" }],
            has_more: false,
          };
        }
        throw new Error(`unexpected cursor: ${start_cursor}`);
      }),
    };

    const ids = await resolveRelationIds({
      pageId: "p",
      propertyId: "rel",
      value: {
        type: "relation",
        relation: first,
        has_more: true,
        next_cursor: "cursor-1",
      },
      pager,
    });
    expect(ids).toHaveLength(27);
    expect(pager.retrieve).toHaveBeenCalled();
  });

  it("archived使用時はエラー、本文ヘルパーが動作する", async () => {
    await expect(
      notionPageToCustomer({
        page: {
          id: "p",
          archived: true,
          properties: {
            ext: {
              id: "ext",
              type: "rich_text",
              rich_text: [{ plain_text: "x" }],
            },
          },
        },
        propertiesByName: propsByName,
        pager: { retrieve: async () => ({ type: "relation", relation: [] }) },
      }),
    ).rejects.toThrow(/in_trash/);

    expect(summarizeText("あ".repeat(250)).endsWith("…")).toBe(true);
    expect(buildHeadingSections([{ heading: "内容", paragraphs: ["本文"] }])).toHaveLength(
      2,
    );
  });

  it("staff external_idは決定的", () => {
    const a = staffExternalId("00000000-0000-4000-8000-000000000001");
    const b = staffExternalId("00000000-0000-4000-8000-000000000001");
    expect(a).toBe(b);
  });
});

import { describe, expect, it } from "vitest";

import {
  getHelpArticle,
  listFeaturedArticles,
  listHelpArticles,
} from "@/lib/help/articles";
import { listHelpFaqs } from "@/lib/help/faq";
import { searchHelpContent } from "@/lib/help/search";
import { findScreenGuide } from "@/lib/help/screens";
import { HELP_TERMS } from "@/lib/help/terminology";
import { resolveNavGroup } from "@/components/layout/nav-active";

describe("help content", () => {
  it("クイックスタート記事がある", () => {
    const a = getHelpArticle("quick-start");
    expect(a?.title).toContain("はじめて");
    expect(a?.steps?.length).toBeGreaterThanOrEqual(8);
  });

  it("featured 記事が複数ある", () => {
    expect(listFeaturedArticles(false).length).toBeGreaterThanOrEqual(8);
  });

  it("管理者専用記事は includeAdmin=false で除外", () => {
    const publicList = listHelpArticles({ includeAdmin: false });
    expect(publicList.every((a) => a.category !== "admin")).toBe(true);
    const withAdmin = listHelpArticles({ includeAdmin: true });
    expect(withAdmin.some((a) => a.category === "admin")).toBe(true);
  });

  it("FAQ は50件以上", () => {
    expect(listHelpFaqs(true).length).toBeGreaterThanOrEqual(50);
  });

  it("用語集に必須語がある", () => {
    const terms = HELP_TERMS.map((t) => t.term);
    expect(terms).toEqual(
      expect.arrayContaining([
        "組織",
        "見込顧客",
        "営業候補",
        "対応履歴",
        "次回アクション",
        "営業連絡不要（DNC）",
      ]),
    );
  });
});

describe("help search", () => {
  it("電話で架電関連がヒットする", () => {
    const hits = searchHelpContent("電話");
    expect(hits.length).toBeGreaterThan(0);
    const titles = hits.map((h) =>
      h.kind === "article"
        ? h.item.title
        : h.kind === "faq"
          ? h.item.question
          : h.item.term,
    );
    expect(titles.some((t) => /電話|架電|再架電/.test(t))).toBe(true);
  });

  it("アポで昇格関連がヒットする", () => {
    const hits = searchHelpContent("アポ");
    expect(
      hits.some(
        (h) =>
          h.kind === "article" &&
          (h.item.slug === "promote-prospect" ||
            h.item.keywords.includes("アポ")),
      ),
    ).toBe(true);
  });

  it("顧客登録で組織記事がヒットする", () => {
    const hits = searchHelpContent("顧客登録");
    expect(
      hits.some(
        (h) => h.kind === "article" && h.item.slug === "create-organization",
      ),
    ).toBe(true);
  });

  it("該当なしは空配列", () => {
    expect(searchHelpContent("zzzznonexistent999")).toEqual([]);
  });

  it("空クエリは空配列", () => {
    expect(searchHelpContent("")).toEqual([]);
    expect(searchHelpContent("   ")).toEqual([]);
  });
});

describe("context help screens", () => {
  it("優先画面にガイドがある", () => {
    for (const path of [
      "/inquiries",
      "/inquiries/abc",
      "/prospect-lists",
      "/prospect-lists/x/import",
      "/prospects",
      "/call-queue",
      "/call-queue/m1",
      "/organizations",
      "/organizations/new",
      "/customers",
      "/activities",
      "/actions",
    ]) {
      expect(findScreenGuide(path), path).toBeTruthy();
    }
  });

  it("無関係な画面にはガイドがない", () => {
    expect(findScreenGuide("/deals")).toBeUndefined();
    expect(findScreenGuide("/help")).toBeUndefined();
  });
});

describe("nav help", () => {
  it("/help はナビグループなし", () => {
    expect(resolveNavGroup("/help")).toBeNull();
    expect(resolveNavGroup("/help/call-prospect")).toBeNull();
  });
});

describe("role labels in help content", () => {
  it("社員向け記事に内部 role code を露出しない", () => {
    const text = listHelpArticles({ includeAdmin: true })
      .flatMap((a) => [
        a.title,
        a.summary,
        ...(a.steps ?? []),
        ...(a.body ?? []),
        ...(a.tips ?? []),
      ])
      .join("\n");
    expect(text).not.toMatch(/\badmin\b/);
    expect(text).not.toMatch(/\bviewer\b/);
    expect(text).not.toMatch(/A権限|B権限|営業A|営業B/);
  });

  it("請求は freee と明記", () => {
    const contract = getHelpArticle("create-contract");
    expect(
      [...(contract?.steps ?? []), ...(contract?.tips ?? [])].join(" "),
    ).toMatch(/freee/);
  });
});

import { describe, expect, it } from "vitest";

import { activityDomainToIndexRow } from "@/lib/activities/index-mapper";
import type { ActivityDomain } from "@/lib/notion/converters/activity";
import { hashActivityBody } from "@/lib/notion/converters/page-body";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const CAT = "11111111-1111-4111-8111-000000000401";

function sample(over: Partial<ActivityDomain> = {}): ActivityDomain {
  const body = "本文テキスト";
  return {
    notionPageId: "page-act-1",
    externalId: "11111111-1111-4111-8111-111111111111",
    inTrash: false,
    title: "対応マッパー",
    customerPageId: CUSTOMER,
    dealPageId: null,
    contactPageIds: [],
    activityAt: "2026-08-07T10:00:00.000Z",
    categoryPageIds: [CAT],
    summary: "要約",
    nextActionNote: null,
    nextActionDate: null,
    createdById: "actor",
    createdByName: "Actor",
    updatedById: "actor",
    updatedByName: "Actor",
    batchId: null,
    body,
    bodyVersion: 1,
    bodyHash: hashActivityBody(body),
    managedBlockIds: ["b1"],
    ...over,
  };
}

describe("activityDomainToIndexRow", () => {
  it("bodyはキャッシュせずbody_hashとsearch_textを写像する", () => {
    const row = activityDomainToIndexRow({
      activity: sample(),
      contentHash: "abc",
      notionLastEditedAt: "2026-08-07T00:00:00.000Z",
      syncStatus: "synced",
      customerDisplayName: "テスト顧客",
      categoryNames: ["電話"],
      nowIso: "2026-08-07T01:00:00.000Z",
    });
    expect(row.notion_page_id).toBe("page-act-1");
    expect(row.body_hash).toBe(hashActivityBody("本文テキスト"));
    expect(row.search_text).toContain("対応マッパー".replace(/\s/g, ""));
    expect(row.category_ids).toEqual([CAT]);
    expect(row.created_by_name).toBe("Actor");
    expect(row).not.toHaveProperty("body");
  });

  it("null summary / deal を保持する", () => {
    const row = activityDomainToIndexRow({
      activity: sample({ summary: null, dealPageId: null }),
      contentHash: "def",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.summary).toBeNull();
    expect(row.deal_page_id).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  canonicalizeActivityWriteInput,
  hashActivityWriteInput,
  sanitizeActivityWriteInput,
} from "@/lib/activities/input-hash";
import type { ActivityWriteInput } from "@/lib/activities/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const DEAL = "22222222-2222-4222-8222-000000000001";
const CONTACT_A = "44444444-4444-4444-8444-000000000001";
const CONTACT_B = "44444444-4444-4444-8444-000000000002";
const CAT_A = "11111111-1111-4111-8111-000000000401";
const CAT_B = "11111111-1111-4111-8111-000000000402";

function sample(over: Partial<ActivityWriteInput> = {}): ActivityWriteInput {
  return {
    title: "対応A",
    customerPageId: CUSTOMER,
    dealPageId: DEAL,
    contactPageIds: [CONTACT_B, CONTACT_A],
    activityAt: "2026-08-07T10:00:00.000Z",
    categoryPageIds: [CAT_B, CAT_A],
    summary: " 要約 ",
    nextActionNote: " 次回 ",
    nextActionDate: "2026-08-10",
    body: "本文です",
    batchId: null,
    ...over,
  };
}

describe("activity input_hash", () => {
  it("sanitizeはタイトル・顧客・対応日時必須", () => {
    expect(() => sanitizeActivityWriteInput(sample({ title: "  " }))).toThrow(
      /タイトル/,
    );
    expect(() =>
      sanitizeActivityWriteInput(sample({ customerPageId: "  " })),
    ).toThrow(/顧客/);
    expect(() =>
      sanitizeActivityWriteInput(sample({ activityAt: "  " })),
    ).toThrow(/対応日時/);
  });

  it("summary空なら本文先頭200字を自動設定", () => {
    const sanitized = sanitizeActivityWriteInput(
      sample({ summary: null, body: "自動要約本文" }),
    );
    expect(sanitized.summary).toBe("自動要約本文");
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeActivityWriteInput(
      sample({
        nextActionNote: "  ",
        nextActionDate: "",
        batchId: "",
        dealPageId: "  ",
      }),
    );
    expect(sanitized.nextActionNote).toBeNull();
    expect(sanitized.nextActionDate).toBeNull();
    expect(sanitized.batchId).toBeNull();
    expect(sanitized.dealPageId).toBeNull();
  });

  it("canonicalizeはcontact/categoryをソートし空白を畳む", () => {
    const canonical = canonicalizeActivityWriteInput(sample());
    expect(canonical.contactPageIds).toEqual([CONTACT_A, CONTACT_B]);
    expect(canonical.categoryPageIds).toEqual([CAT_A, CAT_B]);
    expect(canonical.summary).toBe("要約");
    expect(canonical.nextActionNote).toBe("次回");
  });

  it("同一正規形は同じハッシュ", () => {
    const a = hashActivityWriteInput(
      sample({
        contactPageIds: [CONTACT_A, CONTACT_B],
        categoryPageIds: [CAT_A, CAT_B],
        title: "対応A",
      }),
    );
    const b = hashActivityWriteInput(
      sample({
        contactPageIds: [CONTACT_B, CONTACT_A],
        categoryPageIds: [CAT_B, CAT_A],
        title: " 対応A ",
      }),
    );
    expect(a).toBe(b);
  });

  it("本文や日時の差はハッシュを変える", () => {
    const base = hashActivityWriteInput(sample());
    expect(hashActivityWriteInput(sample({ body: "別本文" }))).not.toBe(base);
    expect(
      hashActivityWriteInput(sample({ activityAt: "2026-08-08T00:00:00.000Z" })),
    ).not.toBe(base);
  });
});

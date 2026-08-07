import { describe, expect, it } from "vitest";

import {
  canonicalizeActionWriteInput,
  hashActionWriteInput,
  sanitizeActionWriteInput,
} from "@/lib/actions/input-hash";
import type { ActionWriteInput } from "@/lib/actions/types";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000501";
const STAFF = "55555555-5555-4555-8555-000000000001";

function sample(over: Partial<ActionWriteInput> = {}): ActionWriteInput {
  return {
    title: "アクションA",
    customerPageId: CUSTOMER,
    dealPageId: null,
    activityPageId: null,
    staffPageId: STAFF,
    dueDate: "2026-08-10",
    statusPageId: STATUS,
    priorityPageId: null,
    completedAt: null,
    ...over,
  };
}

describe("action input_hash", () => {
  it("sanitizeは内容・顧客・期限・状態必須", () => {
    expect(() => sanitizeActionWriteInput(sample({ title: "  " }))).toThrow(
      /アクション内容/,
    );
    expect(() =>
      sanitizeActionWriteInput(sample({ customerPageId: "  " })),
    ).toThrow(/顧客/);
    expect(() => sanitizeActionWriteInput(sample({ dueDate: "" }))).toThrow(
      /期限/,
    );
    expect(() =>
      sanitizeActionWriteInput(sample({ statusPageId: "  " })),
    ).toThrow(/状態/);
  });

  it("空文字はnullへ正規化する", () => {
    const sanitized = sanitizeActionWriteInput(
      sample({
        dealPageId: "  ",
        activityPageId: "",
        staffPageId: " ",
        priorityPageId: "",
        completedAt: "  ",
      }),
    );
    expect(sanitized.dealPageId).toBeNull();
    expect(sanitized.activityPageId).toBeNull();
    expect(sanitized.staffPageId).toBeNull();
    expect(sanitized.priorityPageId).toBeNull();
    expect(sanitized.completedAt).toBeNull();
  });

  it("canonicalizeはタイトル空白を畳む", () => {
    const canonical = canonicalizeActionWriteInput(
      sample({ title: " アクションA " }),
    );
    expect(canonical.title).toBe("アクションA");
  });

  it("同一正規形は同じハッシュ", () => {
    const a = hashActionWriteInput(sample({ title: "アクションA" }));
    const b = hashActionWriteInput(sample({ title: " アクションA " }));
    expect(a).toBe(b);
  });

  it("期限や状態の差はハッシュを変える", () => {
    const base = hashActionWriteInput(sample());
    expect(hashActionWriteInput(sample({ dueDate: "2026-08-11" }))).not.toBe(
      base,
    );
    expect(
      hashActionWriteInput(
        sample({ statusPageId: "11111111-1111-4111-8111-000000000502" }),
      ),
    ).not.toBe(base);
  });
});

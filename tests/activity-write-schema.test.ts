import { describe, expect, it } from "vitest";

import {
  activityWriteSchema,
  prepareActivityWrite,
} from "@/lib/activities/write-schema";
import { isActivitySyncError } from "@/lib/sync/errors";

const CUST = "11111111-1111-4111-8111-000000000001";
const CAT = "11111111-1111-4111-8111-000000000401";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function mockDb(data: {
  masters?: { notion_page_id: string; master_type: string; is_active: boolean }[];
  customers?: {
    notion_page_id: string;
    is_archived: boolean;
    sync_status: string;
  }[];
  contacts?: {
    notion_page_id: string;
    customer_page_id: string | null;
    is_active: boolean;
  }[];
  deals?: { notion_page_id: string; customer_page_id: string | null }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
    customer_index: data.customers ?? [],
    contact_index: data.contacts ?? [],
    deal_index: data.deals ?? [],
  };
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              calls.push(table);
              const rows = (tables[table] ?? []).filter((r) =>
                ids.includes(
                  (r as Record<string, string>).notion_page_id!,
                ),
              );
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  };
}

function validData(overrides: Record<string, unknown> = {}) {
  return {
    title: "test_schema_activity",
    customerPageId: CUST,
    activityAt: "2026-08-07T10:00:00.000Z",
    body: "本文",
    categoryPageIds: [CAT],
    ...overrides,
  };
}

describe("activityWriteSchema", () => {
  it("必須項目と複数分類を許可する", () => {
    expect(activityWriteSchema.safeParse(validData()).success).toBe(true);
    expect(
      activityWriteSchema.safeParse(
        validData({ categoryPageIds: [CAT, CAT] }),
      ).success,
    ).toBe(true);
  });

  it("タイトル必須・対応日時不正を拒否", () => {
    expect(activityWriteSchema.safeParse(validData({ title: "  " })).success).toBe(
      false,
    );
    expect(
      activityWriteSchema.safeParse(validData({ activityAt: "not-a-date" }))
        .success,
    ).toBe(false);
  });

  it("nextActionDateはYYYY-MM-DDのみ", () => {
    expect(
      activityWriteSchema.safeParse(
        validData({ nextActionDate: "2026-08-10" }),
      ).success,
    ).toBe(true);
    expect(
      activityWriteSchema.safeParse(
        validData({ nextActionDate: "2026/08/10" }),
      ).success,
    ).toBe(false);
  });
});

describe("prepareActivityWrite", () => {
  it("有効な入力は正規化済みActivityWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: CAT, master_type: "対応履歴分類", is_active: true },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareActivityWrite({ data: validData(), db });
    expect(write.title).toBe("test_schema_activity");
    expect(write.customerPageId).toBe(CUST);
    expect(write.categoryPageIds).toEqual([CAT]);
  });

  it("不正分類はNotion呼出前に拒否される", async () => {
    const db = mockDb({
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    try {
      await prepareActivityWrite({
        data: validData({ categoryPageIds: [UNKNOWN] }),
        db,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(isActivitySyncError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("validation");
    }
  });

  it("Zod失敗時はlookupしない", async () => {
    const db = mockDb({});
    try {
      await prepareActivityWrite({ data: validData({ title: "" }), db });
      expect.fail("should throw");
    } catch (e) {
      expect(isActivitySyncError(e)).toBe(true);
    }
    expect(db.calls).toEqual([]);
  });
});

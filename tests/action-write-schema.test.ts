import { describe, expect, it } from "vitest";

import {
  actionWriteSchema,
  prepareActionWrite,
} from "@/lib/actions/write-schema";
import { isActionSyncError } from "@/lib/sync/errors";

const CUST = "11111111-1111-4111-8111-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000501";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function mockDb(data: {
  masters?: { notion_page_id: string; master_type: string; is_active: boolean }[];
  customers?: {
    notion_page_id: string;
    is_archived: boolean;
    sync_status: string;
  }[];
  staff?: { notion_staff_page_id: string; is_active: boolean }[];
  deals?: { notion_page_id: string; customer_page_id: string | null }[];
  activities?: { notion_page_id: string; customer_page_id: string | null }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
    customer_index: data.customers ?? [],
    app_users: data.staff ?? [],
    deal_index: data.deals ?? [],
    activity_index: data.activities ?? [],
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
              const idKey =
                table === "app_users" ? "notion_staff_page_id" : "notion_page_id";
              const rows = (tables[table] ?? []).filter((r) =>
                ids.includes((r as Record<string, string>)[idKey]!),
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
    title: "test_schema_action",
    customerPageId: CUST,
    dueDate: "2026-08-10",
    statusPageId: STATUS,
    ...overrides,
  };
}

describe("actionWriteSchema", () => {
  it("必須項目を許可する", () => {
    expect(actionWriteSchema.safeParse(validData()).success).toBe(true);
  });

  it("期限はYYYY-MM-DD必須", () => {
    expect(actionWriteSchema.safeParse(validData({ dueDate: "" })).success).toBe(
      false,
    );
    expect(
      actionWriteSchema.safeParse(validData({ dueDate: "2026/08/10" })).success,
    ).toBe(false);
  });

  it("過去期限も入力自体は許可", () => {
    expect(
      actionWriteSchema.safeParse(validData({ dueDate: "2020-01-01" })).success,
    ).toBe(true);
  });
});

describe("prepareActionWrite", () => {
  it("有効な入力は正規化済みActionWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        {
          notion_page_id: STATUS,
          master_type: "アクション状態",
          is_active: true,
        },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareActionWrite({ data: validData(), db });
    expect(write.title).toBe("test_schema_action");
    expect(write.statusPageId).toBe(STATUS);
  });

  it("不正状態はNotion呼出前に拒否される", async () => {
    const db = mockDb({
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    try {
      await prepareActionWrite({
        data: validData({ statusPageId: UNKNOWN }),
        db,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(isActionSyncError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("validation");
    }
  });
});

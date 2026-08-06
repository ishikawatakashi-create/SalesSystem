import { describe, expect, it, vi } from "vitest";

import { dealWriteSchema, prepareDealWrite } from "@/lib/deals/write-schema";
import { isDealSyncError } from "@/lib/sync/errors";
import { hasPermission } from "@/lib/auth/permissions";

const CUST = "11111111-1111-4111-8111-000000000001";
const STAGE = "11111111-1111-4111-8111-000000000201";
const STATUS = "11111111-1111-4111-8111-000000000301";
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
  staff?: { notion_staff_page_id: string; is_active: boolean }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
    customer_index: data.customers ?? [],
    contact_index: data.contacts ?? [],
    app_users: data.staff ?? [],
  };
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      return {
        select() {
          return {
            in(col: string, ids: string[]) {
              calls.push(table);
              const rows = (tables[table] ?? []).filter((r) => {
                const idKey =
                  table === "app_users" ? "notion_staff_page_id" : "notion_page_id";
                return ids.includes((r as Record<string, string>)[idKey]!);
              });
              void col;
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
    title: "test_schema_deal",
    customerPageId: CUST,
    stagePageId: STAGE,
    statusPageId: STATUS,
    expectedAmount: 1000,
    probability: 40,
    ...overrides,
  };
}

describe("dealWriteSchema amount/probability", () => {
  it("金額: null と 0 を許可する", () => {
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: null })).success,
    ).toBe(true);
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: 0 })).success,
    ).toBe(true);
    expect(
      dealWriteSchema.safeParse(validData({ contractAmount: 0 })).success,
    ).toBe(true);
  });

  it("金額: 負数・小数・文字列からの暗黙0変換を拒否する", () => {
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: -1 })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: 1.5 })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: "0" })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ expectedAmount: "1000" })).success,
    ).toBe(false);
  });

  it("確度: 0〜100整数のみ", () => {
    expect(
      dealWriteSchema.safeParse(validData({ probability: 0 })).success,
    ).toBe(true);
    expect(
      dealWriteSchema.safeParse(validData({ probability: 100 })).success,
    ).toBe(true);
    expect(
      dealWriteSchema.safeParse(validData({ probability: null })).success,
    ).toBe(true);
    expect(
      dealWriteSchema.safeParse(validData({ probability: 101 })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ probability: -1 })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ probability: 50.5 })).success,
    ).toBe(false);
    expect(
      dealWriteSchema.safeParse(validData({ probability: "50" })).success,
    ).toBe(false);
  });

  it("案件名必須", () => {
    expect(dealWriteSchema.safeParse(validData({ title: "  " })).success).toBe(
      false,
    );
  });
});

describe("prepareDealWrite", () => {
  it("有効な入力は正規化済みDealWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: STAGE, master_type: "案件ステージ", is_active: true },
        {
          notion_page_id: STATUS,
          master_type: "案件ステータス",
          is_active: true,
        },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareDealWrite({ data: validData(), db });
    expect(write.title).toBe("test_schema_deal");
    expect(write.customerPageId).toBe(CUST);
    expect(write.expectedAmount).toBe(1000);
  });

  it("不正relationはNotion呼出前に拒否される", async () => {
    const db = mockDb({
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const writeOpsInsert = vi.fn();
    let rejected = false;
    try {
      await prepareDealWrite({
        data: validData({ stagePageId: UNKNOWN }),
        db,
      });
      writeOpsInsert();
    } catch (e) {
      rejected = isDealSyncError(e) && e.code === "validation";
    }
    expect(rejected).toBe(true);
    expect(writeOpsInsert).not.toHaveBeenCalled();
  });

  it("Zod不合格はrelationルックアップを行わない", async () => {
    const db = mockDb({});
    await expect(
      prepareDealWrite({
        data: { title: "", customerPageId: CUST, expectedAmount: -1 },
        db,
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(db.calls).toEqual([]);
  });
});

describe("権限マトリクス(viewer書込拒否)", () => {
  it("viewerはdeal.editを持たない", () => {
    expect(hasPermission("viewer", "deal.edit")).toBe(false);
    expect(hasPermission("b", "deal.edit")).toBe(true);
    expect(hasPermission("a", "deal.edit")).toBe(true);
    expect(hasPermission("admin", "deal.edit")).toBe(true);
  });
});

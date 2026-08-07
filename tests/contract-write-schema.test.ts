import { describe, expect, it, vi } from "vitest";

import {
  contractWriteSchema,
  prepareContractWrite,
} from "@/lib/contracts/write-schema";
import { isContractSyncError } from "@/lib/sync/errors";
import { hasPermission } from "@/lib/auth/permissions";

const CUST = "11111111-1111-4111-8111-000000000001";
const STATUS = "11111111-1111-4111-8111-000000000601";
const PAYMENT = "11111111-1111-4111-8111-000000000651";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function mockDb(data: {
  masters?: { notion_page_id: string; master_type: string; is_active: boolean }[];
  customers?: {
    notion_page_id: string;
    is_archived: boolean;
    sync_status: string;
  }[];
  deals?: { notion_page_id: string; customer_page_id: string | null }[];
  staff?: { notion_staff_page_id: string; is_active: boolean }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
    customer_index: data.customers ?? [],
    deal_index: data.deals ?? [],
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
    title: "test_schema_contract",
    customerPageId: CUST,
    statusPageId: STATUS,
    paymentStatusPageId: PAYMENT,
    amount: 1000,
    autoRenew: false,
    ...overrides,
  };
}

describe("contractWriteSchema amount", () => {
  it("金額: null と 0 を許可する", () => {
    expect(
      contractWriteSchema.safeParse(validData({ amount: null })).success,
    ).toBe(true);
    expect(
      contractWriteSchema.safeParse(validData({ amount: 0 })).success,
    ).toBe(true);
  });

  it("金額: 負数・小数・文字列からの暗黙0変換を拒否する", () => {
    expect(
      contractWriteSchema.safeParse(validData({ amount: -1 })).success,
    ).toBe(false);
    expect(
      contractWriteSchema.safeParse(validData({ amount: 1.5 })).success,
    ).toBe(false);
    expect(
      contractWriteSchema.safeParse(validData({ amount: "0" })).success,
    ).toBe(false);
    expect(
      contractWriteSchema.safeParse(validData({ amount: "1000" })).success,
    ).toBe(false);
  });

  it("契約名・終了日順序・URL形式", () => {
    expect(contractWriteSchema.safeParse(validData({ title: "  " })).success).toBe(
      false,
    );
    expect(
      contractWriteSchema.safeParse(
        validData({ startDate: "2026-08-10", endDate: "2026-08-01" }),
      ).success,
    ).toBe(false);
    expect(
      contractWriteSchema.safeParse(
        validData({ contractUrl: "ftp://example.com" }),
      ).success,
    ).toBe(false);
    expect(
      contractWriteSchema.safeParse(
        validData({ contractUrl: "https://example.com/c" }),
      ).success,
    ).toBe(true);
  });
});

describe("prepareContractWrite", () => {
  it("有効な入力は正規化済みContractWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: STATUS, master_type: "契約状態", is_active: true },
        { notion_page_id: PAYMENT, master_type: "支払状況", is_active: true },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareContractWrite({ data: validData(), db });
    expect(write.title).toBe("test_schema_contract");
    expect(write.customerPageId).toBe(CUST);
    expect(write.amount).toBe(1000);
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
      await prepareContractWrite({
        data: validData({ statusPageId: UNKNOWN }),
        db,
      });
      writeOpsInsert();
    } catch (e) {
      rejected = isContractSyncError(e) && e.code === "validation";
    }
    expect(rejected).toBe(true);
    expect(writeOpsInsert).not.toHaveBeenCalled();
  });

  it("Zod不合格はrelationルックアップを行わない", async () => {
    const db = mockDb({});
    await expect(
      prepareContractWrite({
        data: { title: "", customerPageId: CUST, amount: -1 },
        db,
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(db.calls).toEqual([]);
  });
});

describe("権限マトリクス(viewer書込拒否)", () => {
  it("viewerはcontract.editを持たない", () => {
    expect(hasPermission("viewer", "contract.edit")).toBe(false);
    expect(hasPermission("b", "contract.edit")).toBe(true);
    expect(hasPermission("a", "contract.edit")).toBe(true);
    expect(hasPermission("admin", "contract.edit")).toBe(true);
  });
});

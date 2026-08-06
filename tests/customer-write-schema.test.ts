import { describe, expect, it, vi } from "vitest";

import {
  customerWriteSchema,
  prepareCustomerWrite,
} from "@/lib/customers/write-schema";
import { isCustomerSyncError } from "@/lib/sync/errors";
import { hasPermission } from "@/lib/auth/permissions";

const BIZ = "11111111-1111-4111-8111-000000000001";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

/** 一括ルックアップ用のDBモック(masters_cache / app_users / customer_index) */
function mockDb(data: {
  masters?: { notion_page_id: string; master_type: string; is_active: boolean }[];
  staff?: { notion_staff_page_id: string; is_active: boolean }[];
  customers?: {
    notion_page_id: string;
    is_archived: boolean;
    sync_status: string;
  }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
    app_users: data.staff ?? [],
    customer_index: data.customers ?? [],
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
                  (r as { notion_page_id?: string; notion_staff_page_id?: string })
                    .notion_page_id ??
                    (r as { notion_staff_page_id: string })
                      .notion_staff_page_id,
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
    displayName: "test_schema_customer",
    legalName: "",
    email: "a@example.com",
    businessCategoryPageIds: [BIZ],
    ...overrides,
  };
}

describe("customerWriteSchema", () => {
  it("空文字をnullへ正規化し既定値を補完する", () => {
    const parsed = customerWriteSchema.parse(validData());
    expect(parsed.legalName).toBeNull();
    expect(parsed.tagPageIds).toEqual([]);
    expect(parsed.salesStatusPageId).toBeNull();
    expect(parsed.isArchived).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(parsed, "expectedAmount"),
    ).toBe(false);
  });

  it("表示名必須", () => {
    const r = customerWriteSchema.safeParse(validData({ displayName: "  " }));
    expect(r.success).toBe(false);
  });

  it("メール形式・不正IDを拒否し、見込み金額の手入力キーは無視する", () => {
    expect(
      customerWriteSchema.safeParse(validData({ email: "not-an-email" }))
        .success,
    ).toBe(false);
    expect(
      customerWriteSchema.safeParse(
        validData({ businessCategoryPageIds: ["<script>"] }),
      ).success,
    ).toBe(false);
    // 導出項目のためスキーマに含めない(余分なキーはstrip)
    const withAmount = customerWriteSchema.parse(
      validData({ expectedAmount: 100000 }),
    );
    expect(
      Object.prototype.hasOwnProperty.call(withAmount, "expectedAmount"),
    ).toBe(false);
  });
});

describe("prepareCustomerWrite(Server Actionの検証経路)", () => {
  it("有効な入力は正規化済みCustomerWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: BIZ, master_type: "事業区分", is_active: true },
      ],
    });
    const write = await prepareCustomerWrite({ data: validData(), db });
    expect(write.displayName).toBe("test_schema_customer");
    expect(write.businessCategoryPageIds).toEqual([BIZ]);
  });

  it("不正relationはwrite_operations作成・Notion呼出前に拒否される", async () => {
    const db = mockDb({ masters: [] });
    // Server Actionと同じ順序: prepare成功後にのみpipelineへ進む
    const writeOpsInsert = vi.fn();
    const notionPagesCreate = vi.fn();

    let rejected = false;
    try {
      const write = await prepareCustomerWrite({
        data: validData({ businessCategoryPageIds: [UNKNOWN] }),
        db,
      });
      void write;
      writeOpsInsert();
      notionPagesCreate();
    } catch (e) {
      rejected = isCustomerSyncError(e) && e.code === "validation";
    }
    expect(rejected).toBe(true);
    expect(writeOpsInsert).not.toHaveBeenCalled();
    expect(notionPagesCreate).not.toHaveBeenCalled();
  });

  it("Zod不合格はrelationルックアップ自体を行わない", async () => {
    const db = mockDb({});
    await expect(
      prepareCustomerWrite({ data: { displayName: "" }, db }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(db.calls).toEqual([]);
  });
});

describe("権限マトリクス(viewer書込拒否)", () => {
  it("viewerはcustomer.editを持たない", () => {
    expect(hasPermission("viewer", "customer.view")).toBe(true);
    expect(hasPermission("viewer", "customer.edit")).toBe(false);
    expect(hasPermission("b", "customer.edit")).toBe(true);
    expect(hasPermission("a", "customer.edit")).toBe(true);
    expect(hasPermission("admin", "customer.edit")).toBe(true);
  });
});

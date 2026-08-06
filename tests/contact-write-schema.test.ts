import { describe, expect, it, vi } from "vitest";

import {
  contactWriteSchema,
  prepareContactWrite,
} from "@/lib/contacts/write-schema";
import { isContactSyncError } from "@/lib/sync/errors";
import { hasPermission } from "@/lib/auth/permissions";

const CUST = "11111111-1111-4111-8111-000000000001";
const TYPE = "11111111-1111-4111-8111-000000000101";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

/** 一括ルックアップ用のDBモック(masters_cache / customer_index) */
function mockDb(data: {
  masters?: { notion_page_id: string; master_type: string; is_active: boolean }[];
  customers?: {
    notion_page_id: string;
    is_archived: boolean;
    sync_status: string;
  }[];
}) {
  const tables: Record<string, unknown[]> = {
    masters_cache: data.masters ?? [],
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
                ids.includes((r as { notion_page_id: string }).notion_page_id),
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
    name: "test_schema_contact",
    customerPageId: CUST,
    contactTypePageId: TYPE,
    ...overrides,
  };
}

describe("contactWriteSchema", () => {
  it("氏名必須", () => {
    const r = contactWriteSchema.safeParse(validData({ name: "  " }));
    expect(r.success).toBe(false);
  });

  it("空文字をnullへ正規化し既定値を補完する", () => {
    const parsed = contactWriteSchema.parse(validData());
    expect(parsed.nameKana).toBeNull();
    expect(parsed.isActive).toBe(true);
  });
});

describe("prepareContactWrite(Server Actionの検証経路)", () => {
  it("有効な入力は正規化済みContactWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: TYPE, master_type: "担当者区分", is_active: true },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareContactWrite({ data: validData(), db });
    expect(write.name).toBe("test_schema_contact");
    expect(write.customerPageId).toBe(CUST);
    expect(write.contactTypePageId).toBe(TYPE);
  });

  it("不正relationはwrite_operations作成・Notion呼出前に拒否される", async () => {
    const db = mockDb({
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const writeOpsInsert = vi.fn();
    const notionPagesCreate = vi.fn();

    let rejected = false;
    try {
      const write = await prepareContactWrite({
        data: validData({ contactTypePageId: UNKNOWN }),
        db,
      });
      void write;
      writeOpsInsert();
      notionPagesCreate();
    } catch (e) {
      rejected = isContactSyncError(e) && e.code === "validation";
    }
    expect(rejected).toBe(true);
    expect(writeOpsInsert).not.toHaveBeenCalled();
    expect(notionPagesCreate).not.toHaveBeenCalled();
  });

  it("Zod不合格はrelationルックアップ自体を行わない", async () => {
    const db = mockDb({});
    await expect(
      prepareContactWrite({ data: { name: "", customerPageId: CUST }, db }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(db.calls).toEqual([]);
  });
});

describe("権限マトリクス(viewer書込拒否)", () => {
  it("viewerはcontact.editを持たない", () => {
    expect(hasPermission("viewer", "contact.edit")).toBe(false);
    expect(hasPermission("b", "contact.edit")).toBe(true);
    expect(hasPermission("a", "contact.edit")).toBe(true);
    expect(hasPermission("admin", "contact.edit")).toBe(true);
  });
});

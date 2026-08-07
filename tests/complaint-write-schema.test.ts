import { describe, expect, it } from "vitest";

import {
  complaintWriteSchema,
  prepareComplaintWrite,
} from "@/lib/complaints/write-schema";
import { isComplaintSyncError } from "@/lib/sync/errors";
import { hasPermission } from "@/lib/auth/permissions";

const CUST = "11111111-1111-4111-8111-000000000001";
const SEV = "11111111-1111-4111-8111-000000000701";
const STATUS = "11111111-1111-4111-8111-000000000801";
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
            in(_col: string, ids: string[]) {
              calls.push(table);
              const rows = (tables[table] ?? []).filter((r) => {
                const idKey =
                  table === "app_users" ? "notion_staff_page_id" : "notion_page_id";
                return ids.includes((r as Record<string, string>)[idKey]!);
              });
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
    title: "test_schema_complaint",
    customerPageId: CUST,
    severityPageId: SEV,
    statusPageId: STATUS,
    occurredOn: "2026-08-07",
    content: "内容",
    ...overrides,
  };
}

describe("complaintWriteSchema", () => {
  it("必須項目と本文セクションを許可する", () => {
    expect(complaintWriteSchema.safeParse(validData()).success).toBe(true);
    expect(
      complaintWriteSchema.safeParse(
        validData({
          cause: "原因",
          response: "対応",
          prevention: "防止",
        }),
      ).success,
    ).toBe(true);
  });

  it("タイトル必須・日付不正を拒否", () => {
    expect(
      complaintWriteSchema.safeParse(validData({ title: "  " })).success,
    ).toBe(false);
    expect(
      complaintWriteSchema.safeParse(validData({ occurredOn: "2026/08/07" }))
        .success,
    ).toBe(false);
  });

  it("日付はYYYY-MM-DDのみ", () => {
    expect(
      complaintWriteSchema.safeParse(validData({ dueDate: "2026-08-10" }))
        .success,
    ).toBe(true);
    expect(
      complaintWriteSchema.safeParse(validData({ completedOn: "08-10-2026" }))
        .success,
    ).toBe(false);
  });
});

describe("prepareComplaintWrite", () => {
  it("有効な入力は正規化済みComplaintWriteInputを返す", async () => {
    const db = mockDb({
      masters: [
        { notion_page_id: SEV, master_type: "クレーム重要度", is_active: true },
        {
          notion_page_id: STATUS,
          master_type: "クレーム対応状況",
          is_active: true,
        },
      ],
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    const write = await prepareComplaintWrite({ data: validData(), db });
    expect(write.title).toBe("test_schema_complaint");
    expect(write.customerPageId).toBe(CUST);
    expect(write.severityPageId).toBe(SEV);
  });

  it("不正重要度はNotion呼出前に拒否される", async () => {
    const db = mockDb({
      customers: [
        { notion_page_id: CUST, is_archived: false, sync_status: "synced" },
      ],
    });
    try {
      await prepareComplaintWrite({
        data: validData({ severityPageId: UNKNOWN }),
        db,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(isComplaintSyncError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("validation");
    }
  });

  it("Zod失敗時はlookupしない", async () => {
    const db = mockDb({});
    try {
      await prepareComplaintWrite({ data: validData({ title: "" }), db });
      expect.fail("should throw");
    } catch (e) {
      expect(isComplaintSyncError(e)).toBe(true);
    }
    expect(db.calls).toEqual([]);
  });
});

describe("権限マトリクス(viewer書込拒否)", () => {
  it("viewerはcomplaint.editを持たない", () => {
    expect(hasPermission("viewer", "complaint.edit")).toBe(false);
    expect(hasPermission("b", "complaint.edit")).toBe(true);
    expect(hasPermission("admin", "complaint.edit")).toBe(true);
  });
});

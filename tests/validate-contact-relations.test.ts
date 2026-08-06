import { describe, expect, it } from "vitest";

import {
  collectContactRelationIds,
  validateContactRelations,
  type ContactRelationLooseInput,
  type ContactRelationLookupData,
} from "@/lib/contacts/validate-relations";
import { ContactSyncError, isContactSyncError } from "@/lib/sync/errors";

const M = {
  typeActive: "11111111-1111-4111-8111-000000000101",
  typeInactive: "11111111-1111-4111-8111-000000000102",
  wrongType: "11111111-1111-4111-8111-000000000051",
};
const CUST = {
  ok: "33333333-3333-4333-8333-000000000001",
  archived: "33333333-3333-4333-8333-000000000003",
  deletePending: "33333333-3333-4333-8333-000000000004",
};
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function lookup(): ContactRelationLookupData {
  return {
    masters: [
      {
        notion_page_id: M.typeActive,
        master_type: "担当者区分",
        is_active: true,
      },
      {
        notion_page_id: M.typeInactive,
        master_type: "担当者区分",
        is_active: false,
      },
      {
        notion_page_id: M.wrongType,
        master_type: "案件ステージ",
        is_active: true,
      },
    ],
    customers: [
      { notion_page_id: CUST.ok, is_archived: false, sync_status: "synced" },
      {
        notion_page_id: CUST.archived,
        is_archived: true,
        sync_status: "synced",
      },
      {
        notion_page_id: CUST.deletePending,
        is_archived: false,
        sync_status: "delete_pending",
      },
    ],
  };
}

function input(
  overrides: Partial<ContactRelationLooseInput> = {},
): ContactRelationLooseInput {
  return {
    name: "test_validate_contact",
    nameKana: null,
    customerPageId: CUST.ok,
    department: null,
    title: null,
    phone: null,
    email: null,
    contactTypePageId: M.typeActive,
    note: null,
    isActive: true,
    ...overrides,
  };
}

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (isContactSyncError(e)) {
      expect(e.code).toBe("validation");
      return String(e.detail?.reason);
    }
    throw e;
  }
  throw new Error("expected validation error");
}

describe("validateContactRelations", () => {
  it("有効な顧客+担当者区分を受理する", () => {
    const result = validateContactRelations({
      write: input(),
      lookup: lookup(),
    });
    expect(result.customerPageId).toBe(CUST.ok);
    expect(result.contactTypePageId).toBe(M.typeActive);
  });

  it("存在しない顧客を拒否(invalid_customer_relation)", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({ customerPageId: UNKNOWN }),
          lookup: lookup(),
        }),
      ),
    ).toBe("invalid_customer_relation");
  });

  it("アーカイブ顧客への新規所属を拒否(archived_customer_forbidden)", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({ customerPageId: CUST.archived }),
          lookup: lookup(),
        }),
      ),
    ).toBe("archived_customer_forbidden");
  });

  it("更新前から維持しているアーカイブ顧客は許可", () => {
    const result = validateContactRelations({
      write: input({ customerPageId: CUST.archived }),
      lookup: lookup(),
      context: {
        current: {
          customerPageId: CUST.archived,
          contactTypePageId: M.typeActive,
        },
      },
    });
    expect(result.customerPageId).toBe(CUST.archived);
  });

  it("別master_typeを拒否(wrong_master_type)", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({ contactTypePageId: M.wrongType }),
          lookup: lookup(),
        }),
      ),
    ).toBe("wrong_master_type");
  });

  it("新規の無効区分を拒否し、既存維持は許可", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({ contactTypePageId: M.typeInactive }),
          lookup: lookup(),
        }),
      ),
    ).toBe("inactive_relation");

    const kept = validateContactRelations({
      write: input({ contactTypePageId: M.typeInactive }),
      lookup: lookup(),
      context: {
        current: {
          customerPageId: CUST.ok,
          contactTypePageId: M.typeInactive,
        },
      },
    });
    expect(kept.contactTypePageId).toBe(M.typeInactive);
  });

  it("単一relationに複数件を拒否(too_many_relations)", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({
            contactTypePageId: [M.typeActive, M.typeInactive],
          }),
          lookup: lookup(),
        }),
      ),
    ).toBe("too_many_relations");
  });

  it("必須の所属アカウント欠落を拒否(missing_required_relation)", () => {
    expect(
      reasonOf(() =>
        validateContactRelations({
          write: input({ customerPageId: null }),
          lookup: lookup(),
        }),
      ),
    ).toBe("missing_required_relation");
  });

  it("エラーメッセージにIDを含めない", () => {
    try {
      validateContactRelations({
        write: input({ contactTypePageId: UNKNOWN }),
        lookup: lookup(),
      });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(ContactSyncError);
      expect((e as Error).message).not.toContain(UNKNOWN);
    }
  });
});

describe("collectContactRelationIds", () => {
  it("relation IDを重複なしで収集する", () => {
    const ids = collectContactRelationIds(
      input({
        customerPageId: [CUST.ok, CUST.ok],
        contactTypePageId: [M.typeActive],
      }),
    );
    expect(ids.customerPageIds).toEqual([CUST.ok]);
    expect(ids.masterIds).toEqual([M.typeActive]);
  });
});

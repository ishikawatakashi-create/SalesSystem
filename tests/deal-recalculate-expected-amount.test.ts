import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/notion/client", () => ({
  createDefaultNotionClient: vi.fn(),
}));

vi.mock("@/lib/notion/converters/customer", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/notion/converters/customer")
  >("@/lib/notion/converters/customer");
  return {
    ...actual,
    notionPageToCustomer: vi.fn(async () => ({
      notionPageId: "33333333-3333-4333-8333-000000000001",
      externalId: "cust-ext",
      inTrash: false,
      displayName: "test顧客",
      legalName: null,
      officeName: null,
      postalCode: null,
      prefecture: null,
      city: null,
      addressLine: null,
      phone: null,
      email: null,
      representativeName: null,
      website: null,
      businessCategoryPageIds: [],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: [],
      relatedAccountPageIds: [],
      latestActivitySummary: null,
      lastActivityAt: null,
      nextAction: null,
      nextActionDate: null,
      expectedAmount: 0,
      isArchived: false,
    })),
  };
});

import { computeCustomerExpectedAmountFromDeals } from "@/lib/deals/expected-amount";
import { recalculateCustomerExpectedAmount } from "@/lib/deals/recalculate-expected-amount";
import { notionPageToCustomer } from "@/lib/notion/converters/customer";

const CUSTOMER = "33333333-3333-4333-8333-000000000001";

describe("deal recalculate expected amount (pure)", () => {
  it("active+on_holdのみ合算しnull除外・0加算・空は0", () => {
    expect(
      computeCustomerExpectedAmountFromDeals([
        { status_semantic: "active", expected_amount: 100 },
        { status_semantic: "on_hold", expected_amount: 0 },
        { status_semantic: "active", expected_amount: null },
        { status_semantic: "won", expected_amount: 500 },
      ]),
    ).toBe(100);
    expect(computeCustomerExpectedAmountFromDeals([])).toBe(0);
  });
});

describe("recalculateCustomerExpectedAmount (mocked path)", () => {
  const amountPropId = "prop-expected-amount";

  function makeAdmin(
    deals: Array<{
      status_semantic: string | null;
      expected_amount: number | null;
    }>,
  ) {
    const customerUpdate = vi.fn(async () => ({
      error: null,
    }));
    const auditInsert = vi.fn(async () => ({ error: null }));
    return {
      customerUpdate,
      auditInsert,
      from(table: string) {
        if (table === "deal_index") {
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({ data: deals, error: null });
                },
              };
            },
          };
        }
        if (table === "customer_index") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        expected_amount: 0,
                        external_id: "cust-ext",
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              return {
                eq: async () => {
                  await customerUpdate(payload);
                  return { error: null };
                },
              };
            },
          };
        }
        if (table === "audit_logs") {
          return {
            insert: async (row: unknown) => {
              await auditInsert(row);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  function makeNotion() {
    const update = vi.fn(async () => ({ id: CUSTOMER }));
    return {
      update,
      pages: {
        retrieve: vi.fn(async () => ({
          id: CUSTOMER,
          last_edited_time: "2026-08-07T00:00:00.000Z",
          properties: {},
        })),
        update,
        properties: {
          retrieve: vi.fn(async () => ({
            type: "relation",
            relation: [],
            has_more: false,
          })),
        },
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notionPageToCustomer).mockResolvedValue({
      notionPageId: CUSTOMER,
      externalId: "cust-ext",
      inTrash: false,
      displayName: "test顧客",
      legalName: null,
      officeName: null,
      postalCode: null,
      prefecture: null,
      city: null,
      addressLine: null,
      phone: null,
      email: null,
      representativeName: null,
      website: null,
      businessCategoryPageIds: [],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: [],
      relatedAccountPageIds: [],
      latestActivitySummary: null,
      lastActivityAt: null,
      nextAction: null,
      nextActionDate: null,
      expectedAmount: 0,
      isArchived: false,
    });
  });

  it("deal合算結果をNotion/indexへ反映する", async () => {
    const admin = makeAdmin([
      { status_semantic: "active", expected_amount: 3000 },
      { status_semantic: "on_hold", expected_amount: 2000 },
      { status_semantic: "won", expected_amount: 9000 },
    ]);
    const notion = makeNotion();
    const propertiesByName = {
      見込み金額: { id: amountPropId, type: "number" },
    };

    const result = await recalculateCustomerExpectedAmount({
      customerPageId: CUSTOMER,
      admin: admin as never,
      notion: notion as never,
      propertiesByName,
      sourceDealExternalId: "deal-ext",
      jobId: "job-1",
    });

    expect(result.after).toBe(5000);
    expect(result.dealCount).toBe(2);
    expect(notion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: CUSTOMER,
        properties: { [amountPropId]: { number: 5000 } },
      }),
    );
    expect(admin.customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ expected_amount: 5000 }),
    );
    expect(admin.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "customer.expected_amount.recalculated",
        actor_name: "system",
      }),
    );
  });

  it("対象案件0件なら¥0へ戻す", async () => {
    vi.mocked(notionPageToCustomer).mockResolvedValue({
      notionPageId: CUSTOMER,
      externalId: "cust-ext",
      inTrash: false,
      displayName: "test顧客",
      legalName: null,
      officeName: null,
      postalCode: null,
      prefecture: null,
      city: null,
      addressLine: null,
      phone: null,
      email: null,
      representativeName: null,
      website: null,
      businessCategoryPageIds: [],
      tagPageIds: [],
      salesStatusPageId: null,
      acquisitionRoutePageId: null,
      priorityPageId: null,
      staffPageIds: [],
      relatedAccountPageIds: [],
      latestActivitySummary: null,
      lastActivityAt: null,
      nextAction: null,
      nextActionDate: null,
      expectedAmount: 1000,
      isArchived: false,
    });

    const admin = makeAdmin([
      { status_semantic: "lost", expected_amount: 1000 },
    ]);
    const notion = makeNotion();
    const propertiesByName = {
      見込み金額: { id: amountPropId, type: "number" },
    };

    const result = await recalculateCustomerExpectedAmount({
      customerPageId: CUSTOMER,
      admin: admin as never,
      notion: notion as never,
      propertiesByName,
    });
    expect(result.after).toBe(0);
    expect(notion.update).toHaveBeenCalled();
  });
});

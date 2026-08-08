import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY,
  ORGANIZATION_RELATIONSHIP_MASTER_TYPE,
  ORGANIZATION_RELATIONSHIP_SEEDS,
  organizationRelationshipLabel,
  PRIMARY_ORGANIZATION_RELATIONSHIP_FILTERS,
} from "@/lib/organizations/relationship";
import { INITIAL_MASTERS, assertSemanticKeyUniqueness } from "@/lib/notion/schema/masters";
import { DATABASES, MASTER_TYPES } from "@/lib/notion/schema/databases";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import { parseCustomerListParams } from "@/lib/customers/list-params";

describe("organization relationship masters", () => {
  it("MASTER_TYPES と INITIAL_MASTERS に関係性がある", () => {
    expect(MASTER_TYPES).toContain("関係性");
    expect(ORGANIZATION_RELATIONSHIP_MASTER_TYPE).toBe("関係性");
    const rel = INITIAL_MASTERS.filter((m) => m.masterType === "関係性");
    expect(rel).toHaveLength(ORGANIZATION_RELATIONSHIP_SEEDS.length);
    for (const seed of ORGANIZATION_RELATIONSHIP_SEEDS) {
      expect(rel.some((m) => m.semanticKey === seed.semanticKey)).toBe(true);
    }
    expect(() => assertSemanticKeyUniqueness(INITIAL_MASTERS)).not.toThrow();
  });

  it("customers DB に multi relation 関係性がある", () => {
    const customers = DATABASES.find((d) => d.key === "customers");
    expect(customers).toBeTruthy();
    const rel = customers!.phaseBRelations.find((p) => p.name === "関係性");
    expect(rel).toBeTruthy();
    expect(rel && "target" in rel ? rel.target : null).toBe("masters");
    expect(rel && "single" in rel ? rel.single : undefined).toBeUndefined();
  });

  it("日本語ラベルと default", () => {
    expect(organizationRelationshipLabel("customer")).toBe("顧客");
    expect(organizationRelationshipLabel("media")).toBe("メディア");
    expect(DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY).toBe("customer");
    expect(PRIMARY_ORGANIZATION_RELATIONSHIP_FILTERS.length).toBeGreaterThan(3);
  });
});

describe("organization index / list filter", () => {
  it("multi relationship semantic keys を index 行へ載せる", () => {
    const row = customerDomainToIndexRow({
      customer: {
        notionPageId: "11111111-1111-4111-8111-111111111111",
        externalId: "22222222-2222-4222-8222-222222222222",
        inTrash: false,
        displayName: "テスト組織",
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
        relationshipPageIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ],
        salesStatusPageId: null,
        acquisitionRoutePageId: null,
        priorityPageId: null,
        staffPageIds: [],
        relatedAccountPageIds: [],
        latestActivitySummary: null,
        lastActivityAt: null,
        nextAction: null,
        nextActionDate: null,
        expectedAmount: null,
        isArchived: false,
      },
      staffUserIds: [],
      relationshipSemanticKeys: ["media", "prospect"],
      contentHash: "abc",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.relationship_ids).toHaveLength(2);
    expect(row.relationship_semantic_keys).toEqual(["media", "prospect"]);
  });

  it("list params が relationship filter を読む", () => {
    const { query } = parseCustomerListParams({
      relationship: "municipality",
    });
    expect(query.relationshipSemanticKey).toBe("municipality");
    const bad = parseCustomerListParams({ relationship: "nope" });
    expect(bad.query.relationshipSemanticKey).toBeUndefined();
  });
});

describe("compatibility / static checks", () => {
  it("/customers 互換 redirect がある", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/app/(main)/customers/page.tsx"),
      "utf8",
    );
    expect(src).toContain("/organizations");
    expect(src).toContain("relationship");
    expect(src).toContain("customer");
  });

  it("createCustomerAction は空関係性に customer default", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/features/customers/actions.ts"),
      "utf8",
    );
    expect(src).toContain("DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY");
    expect(src).toContain("findRelationshipMasterPageId");
  });

  it("Apps Script send ではなく draft 静的チェックは別テスト。backfill job は Notion update 経由", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/customers/backfill-default-relationship.ts"),
      "utf8",
    );
    expect(src).toContain("customerUpdate");
    expect(src).toContain("relationshipPageIds");
    expect(src).not.toContain('from("customer_index").update');
  });

  it("CSV create は default relationship", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/csv/process-row.ts"),
      "utf8",
    );
    expect(src).toContain("DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY");
  });

  it("permission は customer.* のまま", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/auth/permissions.ts"),
      "utf8",
    );
    expect(src).toContain("customer.view");
    expect(src).toContain("customer.edit");
    expect(src).not.toContain("organization.view");
  });
});

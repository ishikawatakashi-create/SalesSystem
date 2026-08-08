import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/normalize/domain";
import { customerDomainToIndexRow } from "@/lib/customers/index-mapper";
import type { CustomerDomain } from "@/lib/notion/converters/customer";

describe("Phase13B formal match keys", () => {
  it("normalizeDomain prefers website host (www stripped)", () => {
    expect(normalizeDomain("https://www.Example.com/path")).toBe("example.com");
  });

  it("plain company label without host shape is not a match domain", () => {
    // ドットなし・スペースあり → host として無効
    expect(normalizeDomain("株式会社 テスト商事")).toBeNull();
  });

  it("customerDomainToIndexRow writes normalized_domain", () => {
    const customer = {
      notionPageId: "page",
      externalId: "ext",
      displayName: "Acme",
      legalName: null,
      officeName: null,
      postalCode: null,
      prefecture: null,
      city: null,
      addressLine: null,
      phone: "03-1234-5678",
      email: "info@acme.example",
      representativeName: null,
      website: "https://www.acme.example/",
      businessCategoryPageIds: [],
      tagPageIds: [],
      relationshipPageIds: [],
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
    } as unknown as CustomerDomain;

    const row = customerDomainToIndexRow({
      customer,
      staffUserIds: [],
      contentHash: "h",
      notionLastEditedAt: null,
      syncStatus: "synced",
    });
    expect(row.normalized_domain).toBe("acme.example");
    expect(row.phone_normalized).toBeTruthy();
  });
});

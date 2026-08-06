import { createHash } from "node:crypto";

import type { CustomerDomain } from "@/lib/notion/converters/customer";
import type { CustomerWriteInput } from "@/lib/customers/types";

function sorted(ids: string[]) {
  return [...ids].sort();
}

/**
 * 楽観ロック・復旧比較用の content_hash。
 * 導出キャッシュも含めたドメイン全体の指紋。
 */
export function hashCustomerDomain(
  customer: Omit<CustomerDomain, "notionPageId" | "inTrash">,
): string {
  const payload = {
    externalId: customer.externalId,
    displayName: customer.displayName,
    legalName: customer.legalName,
    officeName: customer.officeName,
    postalCode: customer.postalCode,
    prefecture: customer.prefecture,
    city: customer.city,
    addressLine: customer.addressLine,
    phone: customer.phone,
    email: customer.email,
    representativeName: customer.representativeName,
    website: customer.website,
    businessCategoryPageIds: sorted(customer.businessCategoryPageIds),
    tagPageIds: sorted(customer.tagPageIds),
    salesStatusPageId: customer.salesStatusPageId,
    acquisitionRoutePageId: customer.acquisitionRoutePageId,
    priorityPageId: customer.priorityPageId,
    staffPageIds: sorted(customer.staffPageIds),
    relatedAccountPageIds: sorted(customer.relatedAccountPageIds),
    latestActivitySummary: customer.latestActivitySummary,
    lastActivityAt: customer.lastActivityAt,
    nextAction: customer.nextAction,
    nextActionDate: customer.nextActionDate,
    expectedAmount: customer.expectedAmount,
    isArchived: customer.isArchived,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

/** 書込入力+external_id(+既存導出値)から期待ハッシュを計算 */
export function hashCustomerWriteWithExternalId(input: {
  externalId: string;
  write: CustomerWriteInput;
  derived?: Partial<
    Pick<
      CustomerDomain,
      | "latestActivitySummary"
      | "lastActivityAt"
      | "nextAction"
      | "nextActionDate"
      | "expectedAmount"
    >
  >;
}): string {
  return hashCustomerDomain({
    externalId: input.externalId,
    displayName: input.write.displayName,
    legalName: input.write.legalName,
    officeName: input.write.officeName,
    postalCode: input.write.postalCode,
    prefecture: input.write.prefecture,
    city: input.write.city,
    addressLine: input.write.addressLine,
    phone: input.write.phone,
    email: input.write.email,
    representativeName: input.write.representativeName,
    website: input.write.website,
    businessCategoryPageIds: input.write.businessCategoryPageIds,
    tagPageIds: input.write.tagPageIds,
    salesStatusPageId: input.write.salesStatusPageId,
    acquisitionRoutePageId: input.write.acquisitionRoutePageId,
    priorityPageId: input.write.priorityPageId,
    staffPageIds: input.write.staffPageIds,
    relatedAccountPageIds: input.write.relatedAccountPageIds,
    latestActivitySummary: input.derived?.latestActivitySummary ?? null,
    lastActivityAt: input.derived?.lastActivityAt ?? null,
    nextAction: input.derived?.nextAction ?? null,
    nextActionDate: input.derived?.nextActionDate ?? null,
    expectedAmount: input.derived?.expectedAmount ?? null,
    isArchived: input.write.isArchived,
  });
}

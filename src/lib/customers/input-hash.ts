import { createHash } from "node:crypto";

import type { CustomerWriteInput } from "@/lib/customers/types";
import {
  normalizeCompanyNameForHash,
  normalizeEmailOrNull,
  normalizePhone,
  normalizePostalCode,
  sanitizeUrlForStorage,
  emptyToNull,
} from "@/lib/normalize";

/**
 * input_hash用に正規化した正規形。
 * 表示原文そのものではなく、照合に使う正規化値+ID集合でハッシュする。
 */
export function canonicalizeCustomerWriteInput(
  input: CustomerWriteInput,
): Record<string, unknown> {
  const sorted = (ids: string[]) => [...ids].sort();
  return {
    displayName: normalizeCompanyNameForHash(input.displayName) ?? "",
    legalName: normalizeCompanyNameForHash(input.legalName),
    officeName: normalizeCompanyNameForHash(input.officeName),
    postalCode: normalizePostalCode(input.postalCode),
    prefecture: emptyToNull(input.prefecture),
    city: emptyToNull(input.city),
    addressLine: emptyToNull(input.addressLine),
    phone: normalizePhone(input.phone),
    email: normalizeEmailOrNull(input.email),
    representativeName: emptyToNull(input.representativeName),
    website: sanitizeUrlForStorage(input.website),
    businessCategoryPageIds: sorted(input.businessCategoryPageIds),
    tagPageIds: sorted(input.tagPageIds),
    salesStatusPageId: input.salesStatusPageId,
    acquisitionRoutePageId: input.acquisitionRoutePageId,
    priorityPageId: input.priorityPageId,
    staffPageIds: sorted(input.staffPageIds),
    relatedAccountPageIds: sorted(input.relatedAccountPageIds),
    expectedAmount: input.expectedAmount,
    isArchived: input.isArchived,
  };
}

export function hashCustomerWriteInput(input: CustomerWriteInput): string {
  const canonical = canonicalizeCustomerWriteInput(input);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 * 検索用正規化値とは分離する。
 */
export function sanitizeCustomerWriteInput(
  input: CustomerWriteInput,
): CustomerWriteInput {
  const name = emptyToNull(input.displayName);
  if (!name) {
    throw new Error("表示名は必須です");
  }
  return {
    displayName: name,
    legalName: emptyToNull(input.legalName),
    officeName: emptyToNull(input.officeName),
    postalCode: emptyToNull(input.postalCode),
    prefecture: emptyToNull(input.prefecture),
    city: emptyToNull(input.city),
    addressLine: emptyToNull(input.addressLine),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    representativeName: emptyToNull(input.representativeName),
    website: sanitizeUrlForStorage(input.website),
    businessCategoryPageIds: [...input.businessCategoryPageIds],
    tagPageIds: [...input.tagPageIds],
    salesStatusPageId: input.salesStatusPageId,
    acquisitionRoutePageId: input.acquisitionRoutePageId,
    priorityPageId: input.priorityPageId,
    staffPageIds: [...input.staffPageIds],
    relatedAccountPageIds: [...input.relatedAccountPageIds],
    expectedAmount:
      typeof input.expectedAmount === "number" &&
      Number.isFinite(input.expectedAmount)
        ? input.expectedAmount
        : null,
    isArchived: Boolean(input.isArchived),
  };
}

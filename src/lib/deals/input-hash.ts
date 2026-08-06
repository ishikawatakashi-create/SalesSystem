import { createHash } from "node:crypto";

import type { DealWriteInput } from "@/lib/deals/types";
import {
  collapseWhitespace,
  emptyToNull,
  toHalfWidthAscii,
} from "@/lib/normalize";

function sorted(ids: string[]) {
  return [...ids].sort();
}

/**
 * input_hash用に正規化した正規形。
 */
export function canonicalizeDealWriteInput(
  input: DealWriteInput,
): Record<string, unknown> {
  return {
    title: collapseWhitespace(toHalfWidthAscii(input.title)),
    customerPageId: input.customerPageId,
    contactPageIds: sorted(input.contactPageIds),
    businessCategoryPageId: input.businessCategoryPageId,
    productName: emptyToNull(
      input.productName
        ? collapseWhitespace(toHalfWidthAscii(input.productName))
        : null,
    ),
    stagePageId: input.stagePageId,
    staffPageIds: sorted(input.staffPageIds),
    expectedAmount: input.expectedAmount,
    contractAmount: input.contractAmount,
    probability: input.probability,
    expectedCloseDate: input.expectedCloseDate,
    contractedAt: input.contractedAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lostReason: emptyToNull(
      input.lostReason
        ? collapseWhitespace(toHalfWidthAscii(input.lostReason))
        : null,
    ),
    statusPageId: input.statusPageId,
    note: emptyToNull(
      input.note ? collapseWhitespace(toHalfWidthAscii(input.note)) : null,
    ),
  };
}

export function hashDealWriteInput(input: DealWriteInput): string {
  const canonical = canonicalizeDealWriteInput(input);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 */
export function sanitizeDealWriteInput(input: DealWriteInput): DealWriteInput {
  const title = emptyToNull(input.title);
  if (!title) {
    throw new Error("案件名は必須です");
  }
  const customerPageId = emptyToNull(input.customerPageId);
  if (!customerPageId) {
    throw new Error("顧客アカウントは必須です");
  }

  const textField = (v: string | null | undefined): string | null => {
    const t = emptyToNull(v);
    return t ? collapseWhitespace(t) : null;
  };

  return {
    title: collapseWhitespace(title),
    customerPageId,
    contactPageIds: [...input.contactPageIds],
    businessCategoryPageId: input.businessCategoryPageId,
    productName: textField(input.productName),
    stagePageId: input.stagePageId,
    staffPageIds: [...input.staffPageIds],
    expectedAmount: input.expectedAmount,
    contractAmount: input.contractAmount,
    probability: input.probability,
    expectedCloseDate: emptyToNull(input.expectedCloseDate),
    contractedAt: emptyToNull(input.contractedAt),
    periodStart: emptyToNull(input.periodStart),
    periodEnd: emptyToNull(input.periodEnd),
    lostReason: textField(input.lostReason),
    statusPageId: input.statusPageId,
    note: textField(input.note),
  };
}

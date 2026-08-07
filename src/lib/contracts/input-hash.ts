import { createHash } from "node:crypto";

import type { ContractWriteInput } from "@/lib/contracts/types";
import {
  collapseWhitespace,
  emptyToNull,
  toHalfWidthAscii,
} from "@/lib/normalize";

function sorted(ids: string[]) {
  return [...ids].sort();
}

export function canonicalizeContractWriteInput(
  input: ContractWriteInput,
): Record<string, unknown> {
  return {
    title: collapseWhitespace(toHalfWidthAscii(input.title)),
    customerPageId: input.customerPageId,
    dealPageId: input.dealPageId,
    contractTypePageId: input.contractTypePageId,
    tradeTypePageId: input.tradeTypePageId,
    paymentStatusPageId: input.paymentStatusPageId,
    statusPageId: input.statusPageId,
    staffPageIds: sorted(input.staffPageIds),
    amount: input.amount,
    contractedAt: input.contractedAt,
    startDate: input.startDate,
    endDate: input.endDate,
    autoRenew: input.autoRenew,
    billingTerms: emptyToNull(
      input.billingTerms
        ? collapseWhitespace(toHalfWidthAscii(input.billingTerms))
        : null,
    ),
    contractUrl: emptyToNull(input.contractUrl),
    note: emptyToNull(
      input.note ? collapseWhitespace(toHalfWidthAscii(input.note)) : null,
    ),
  };
}

export function hashContractWriteInput(input: ContractWriteInput): string {
  const canonical = canonicalizeContractWriteInput(input);
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/**
 * 表示用原文のサニタイズ(Notion保存値)。
 */
export function sanitizeContractWriteInput(
  input: ContractWriteInput,
): ContractWriteInput {
  const title = emptyToNull(input.title);
  if (!title) {
    throw new Error("契約名は必須です");
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
    dealPageId: emptyToNull(input.dealPageId),
    contractTypePageId: input.contractTypePageId,
    tradeTypePageId: input.tradeTypePageId,
    paymentStatusPageId: input.paymentStatusPageId,
    statusPageId: input.statusPageId,
    staffPageIds: [...input.staffPageIds],
    amount: input.amount,
    contractedAt: emptyToNull(input.contractedAt),
    startDate: emptyToNull(input.startDate),
    endDate: emptyToNull(input.endDate),
    autoRenew: Boolean(input.autoRenew),
    billingTerms: textField(input.billingTerms),
    contractUrl: emptyToNull(input.contractUrl),
    note: textField(input.note),
  };
}

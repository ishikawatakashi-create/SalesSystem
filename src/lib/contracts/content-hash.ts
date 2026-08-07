import { createHash } from "node:crypto";

import type { ContractDomain } from "@/lib/notion/converters/contract";
import type { ContractWriteInput } from "@/lib/contracts/types";

function sorted(ids: string[]) {
  return [...ids].sort();
}

/**
 * 楽観ロック・復旧比較用の content_hash。
 * 契約書ファイル(files)の中身は含めず hasContractFile のみ。
 */
export function hashContractDomain(
  contract: Omit<
    ContractDomain,
    "notionPageId" | "inTrash" | "contractFiles"
  >,
): string {
  const payload = {
    externalId: contract.externalId,
    title: contract.title,
    customerPageId: contract.customerPageId,
    dealPageId: contract.dealPageId,
    contractTypePageId: contract.contractTypePageId,
    tradeTypePageId: contract.tradeTypePageId,
    paymentStatusPageId: contract.paymentStatusPageId,
    statusPageId: contract.statusPageId,
    staffPageIds: sorted(contract.staffPageIds),
    amount: contract.amount,
    contractedAt: contract.contractedAt,
    startDate: contract.startDate,
    endDate: contract.endDate,
    autoRenew: contract.autoRenew,
    billingTerms: contract.billingTerms,
    contractUrl: contract.contractUrl,
    hasContractFile: contract.hasContractFile,
    note: contract.note,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function hashContractWriteWithExternalId(input: {
  externalId: string;
  write: ContractWriteInput;
  /** 更新時は既存の hasContractFile を維持(書込対象外) */
  hasContractFile?: boolean;
}): string {
  return hashContractDomain({
    externalId: input.externalId,
    title: input.write.title,
    customerPageId: input.write.customerPageId,
    dealPageId: input.write.dealPageId,
    contractTypePageId: input.write.contractTypePageId,
    tradeTypePageId: input.write.tradeTypePageId,
    paymentStatusPageId: input.write.paymentStatusPageId,
    statusPageId: input.write.statusPageId,
    staffPageIds: input.write.staffPageIds,
    amount: input.write.amount,
    contractedAt: input.write.contractedAt,
    startDate: input.write.startDate,
    endDate: input.write.endDate,
    autoRenew: input.write.autoRenew,
    billingTerms: input.write.billingTerms,
    contractUrl: input.write.contractUrl,
    hasContractFile: input.hasContractFile ?? false,
    note: input.write.note,
  });
}

import type { ContractDomain } from "@/lib/notion/converters/contract";
import type { ContractWriteInput } from "@/lib/contracts/types";
import {
  contractToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/contract";

export function writeInputToContractDomainFields(
  externalId: string,
  write: ContractWriteInput,
  hasContractFile = false,
): Omit<
  ContractDomain,
  "notionPageId" | "inTrash" | "contractFiles" | "hasContractFile"
> & { hasContractFile: boolean } {
  return {
    externalId,
    title: write.title,
    customerPageId: write.customerPageId,
    dealPageId: write.dealPageId,
    contractTypePageId: write.contractTypePageId,
    tradeTypePageId: write.tradeTypePageId,
    paymentStatusPageId: write.paymentStatusPageId,
    statusPageId: write.statusPageId,
    staffPageIds: write.staffPageIds,
    amount: write.amount,
    contractedAt: write.contractedAt,
    startDate: write.startDate,
    endDate: write.endDate,
    autoRenew: write.autoRenew,
    billingTerms: write.billingTerms,
    contractUrl: write.contractUrl,
    hasContractFile,
    note: write.note,
  };
}

export function buildContractPropertyDiff(input: {
  before: ContractDomain;
  write: ContractWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain = writeInputToContractDomainFields(
    input.before.externalId,
    input.write,
    input.before.hasContractFile,
  );

  const beforeProps = contractToNotionProperties({
    contract: {
      externalId: input.before.externalId,
      title: input.before.title,
      customerPageId: input.before.customerPageId,
      dealPageId: input.before.dealPageId,
      contractTypePageId: input.before.contractTypePageId,
      tradeTypePageId: input.before.tradeTypePageId,
      paymentStatusPageId: input.before.paymentStatusPageId,
      statusPageId: input.before.statusPageId,
      staffPageIds: input.before.staffPageIds,
      amount: input.before.amount,
      contractedAt: input.before.contractedAt,
      startDate: input.before.startDate,
      endDate: input.before.endDate,
      autoRenew: input.before.autoRenew,
      billingTerms: input.before.billingTerms,
      contractUrl: input.before.contractUrl,
      note: input.before.note,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = contractToNotionProperties({
    contract: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildContractChangedFieldsAudit(input: {
  before: ContractDomain;
  write: ContractWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["契約名", input.before.title, input.write.title],
    ["顧客アカウント", input.before.customerPageId, input.write.customerPageId],
    ["関連案件", input.before.dealPageId, input.write.dealPageId],
    [
      "契約区分",
      input.before.contractTypePageId,
      input.write.contractTypePageId,
    ],
    ["取引区分", input.before.tradeTypePageId, input.write.tradeTypePageId],
    [
      "支払状況",
      input.before.paymentStatusPageId,
      input.write.paymentStatusPageId,
    ],
    ["状態", input.before.statusPageId, input.write.statusPageId],
    ["担当者", input.before.staffPageIds, input.write.staffPageIds],
    ["契約金額", input.before.amount, input.write.amount],
    ["契約日", input.before.contractedAt, input.write.contractedAt],
    ["契約開始日", input.before.startDate, input.write.startDate],
    ["契約終了日", input.before.endDate, input.write.endDate],
    ["自動更新", input.before.autoRenew, input.write.autoRenew],
    ["請求条件", input.before.billingTerms, input.write.billingTerms],
    ["契約書URL", input.before.contractUrl, input.write.contractUrl],
    ["備考", input.before.note, input.write.note],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}

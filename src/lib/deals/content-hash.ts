import { createHash } from "node:crypto";

import type { DealDomain } from "@/lib/notion/converters/deal";
import type { DealWriteInput } from "@/lib/deals/types";

function sorted(ids: string[]) {
  return [...ids].sort();
}

/**
 * 楽観ロック・復旧比較用の content_hash。
 * 導出キャッシュも含めたドメイン全体の指紋。
 */
export function hashDealDomain(
  deal: Omit<DealDomain, "notionPageId" | "inTrash">,
): string {
  const payload = {
    externalId: deal.externalId,
    title: deal.title,
    customerPageId: deal.customerPageId,
    contactPageIds: sorted(deal.contactPageIds),
    businessCategoryPageId: deal.businessCategoryPageId,
    productName: deal.productName,
    stagePageId: deal.stagePageId,
    staffPageIds: sorted(deal.staffPageIds),
    expectedAmount: deal.expectedAmount,
    contractAmount: deal.contractAmount,
    probability: deal.probability,
    expectedCloseDate: deal.expectedCloseDate,
    contractedAt: deal.contractedAt,
    periodStart: deal.periodStart,
    periodEnd: deal.periodEnd,
    nextAction: deal.nextAction,
    nextActionDate: deal.nextActionDate,
    lostReason: deal.lostReason,
    statusPageId: deal.statusPageId,
    note: deal.note,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

/** 書込入力+external_id(+既存導出値)から期待ハッシュを計算 */
export function hashDealWriteWithExternalId(input: {
  externalId: string;
  write: DealWriteInput;
  derived?: Partial<Pick<DealDomain, "nextAction" | "nextActionDate">>;
}): string {
  return hashDealDomain({
    externalId: input.externalId,
    title: input.write.title,
    customerPageId: input.write.customerPageId,
    contactPageIds: input.write.contactPageIds,
    businessCategoryPageId: input.write.businessCategoryPageId,
    productName: input.write.productName,
    stagePageId: input.write.stagePageId,
    staffPageIds: input.write.staffPageIds,
    expectedAmount: input.write.expectedAmount,
    contractAmount: input.write.contractAmount,
    probability: input.write.probability,
    expectedCloseDate: input.write.expectedCloseDate,
    contractedAt: input.write.contractedAt,
    periodStart: input.write.periodStart,
    periodEnd: input.write.periodEnd,
    nextAction: input.derived?.nextAction ?? null,
    nextActionDate: input.derived?.nextActionDate ?? null,
    lostReason: input.write.lostReason,
    statusPageId: input.write.statusPageId,
    note: input.write.note,
  });
}

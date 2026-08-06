import type { DealDomain } from "@/lib/notion/converters/deal";
import type { DealWriteInput } from "@/lib/deals/types";
import {
  dealToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/deal";

/**
 * 更新時に送る差分プロパティのみ抽出(導出キャッシュはユーザー入力に含めない)。
 */
export const DERIVED_DEAL_PROPERTY_NAMES = [
  "次回アクション",
  "次回予定日",
] as const;

/** 案件create/updateでNotionへ送らない導出プロパティを除外する */
export function omitDerivedDealProperties(
  properties: Record<string, unknown>,
  propertiesByName: PropertyIdMap,
): Record<string, unknown> {
  const skipIds = new Set(
    DERIVED_DEAL_PROPERTY_NAMES.map((n) => propertiesByName[n]?.id).filter(
      (id): id is string => Boolean(id),
    ),
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (skipIds.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function buildDealPropertyDiff(input: {
  before: DealDomain;
  write: DealWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain: Omit<DealDomain, "notionPageId" | "inTrash"> = {
    externalId: input.before.externalId,
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
    // 導出は維持(ユーザー書込対象外)
    nextAction: input.before.nextAction,
    nextActionDate: input.before.nextActionDate,
    lostReason: input.write.lostReason,
    statusPageId: input.write.statusPageId,
    note: input.write.note,
  };

  const beforeProps = dealToNotionProperties({
    deal: {
      externalId: input.before.externalId,
      title: input.before.title,
      customerPageId: input.before.customerPageId,
      contactPageIds: input.before.contactPageIds,
      businessCategoryPageId: input.before.businessCategoryPageId,
      productName: input.before.productName,
      stagePageId: input.before.stagePageId,
      staffPageIds: input.before.staffPageIds,
      expectedAmount: input.before.expectedAmount,
      contractAmount: input.before.contractAmount,
      probability: input.before.probability,
      expectedCloseDate: input.before.expectedCloseDate,
      contractedAt: input.before.contractedAt,
      periodStart: input.before.periodStart,
      periodEnd: input.before.periodEnd,
      nextAction: input.before.nextAction,
      nextActionDate: input.before.nextActionDate,
      lostReason: input.before.lostReason,
      statusPageId: input.before.statusPageId,
      note: input.before.note,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = dealToNotionProperties({
    deal: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  const skipIds = new Set(
    DERIVED_DEAL_PROPERTY_NAMES.map(
      (n) => input.propertiesByName[n]?.id,
    ).filter((id): id is string => Boolean(id)),
  );

  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(afterProps)) {
    if (skipIds.has(key)) continue;
    const before = beforeProps[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      diff[key] = value;
    }
  }
  return diff;
}

export function buildChangedFieldsAudit(input: {
  before: DealDomain;
  write: DealWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["案件名", input.before.title, input.write.title],
    ["顧客アカウント", input.before.customerPageId, input.write.customerPageId],
    ["顧客担当者", input.before.contactPageIds, input.write.contactPageIds],
    [
      "事業区分",
      input.before.businessCategoryPageId,
      input.write.businessCategoryPageId,
    ],
    ["商材", input.before.productName, input.write.productName],
    ["営業ステージ", input.before.stagePageId, input.write.stagePageId],
    ["自社担当者", input.before.staffPageIds, input.write.staffPageIds],
    ["見込み金額", input.before.expectedAmount, input.write.expectedAmount],
    ["契約金額", input.before.contractAmount, input.write.contractAmount],
    ["確度", input.before.probability, input.write.probability],
    [
      "受注予定日",
      input.before.expectedCloseDate,
      input.write.expectedCloseDate,
    ],
    ["契約日", input.before.contractedAt, input.write.contractedAt],
    ["契約期間開始", input.before.periodStart, input.write.periodStart],
    ["契約期間終了", input.before.periodEnd, input.write.periodEnd],
    ["失注理由", input.before.lostReason, input.write.lostReason],
    ["ステータス", input.before.statusPageId, input.write.statusPageId],
    ["備考", input.before.note, input.write.note],
  ];
  for (const [field, before, after] of pairs) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}

export function writeInputToDomainFields(
  externalId: string,
  write: DealWriteInput,
  derived?: Partial<Pick<DealDomain, "nextAction" | "nextActionDate">>,
): Omit<DealDomain, "notionPageId" | "inTrash"> {
  return {
    externalId,
    title: write.title,
    customerPageId: write.customerPageId,
    contactPageIds: write.contactPageIds,
    businessCategoryPageId: write.businessCategoryPageId,
    productName: write.productName,
    stagePageId: write.stagePageId,
    staffPageIds: write.staffPageIds,
    expectedAmount: write.expectedAmount,
    contractAmount: write.contractAmount,
    probability: write.probability,
    expectedCloseDate: write.expectedCloseDate,
    contractedAt: write.contractedAt,
    periodStart: write.periodStart,
    periodEnd: write.periodEnd,
    nextAction: derived?.nextAction ?? null,
    nextActionDate: derived?.nextActionDate ?? null,
    lostReason: write.lostReason,
    statusPageId: write.statusPageId,
    note: write.note,
  };
}

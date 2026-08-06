import type { CustomerDomain } from "@/lib/notion/converters/customer";
import type { CustomerWriteInput } from "@/lib/customers/types";
import {
  customerToNotionProperties,
  type PropertyIdMap,
} from "@/lib/notion/converters/customer";

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * 更新時に送る差分プロパティのみ抽出(導出キャッシュはユーザー入力に含めない)。
 */
export const DERIVED_CUSTOMER_PROPERTY_NAMES = [
  "最新対応内容",
  "最終対応日",
  "次回アクション",
  "次回予定日",
  "見込み金額",
] as const;

/** 顧客create/updateでNotionへ送らない導出プロパティを除外する */
export function omitDerivedCustomerProperties(
  properties: Record<string, unknown>,
  propertiesByName: PropertyIdMap,
): Record<string, unknown> {
  const skipIds = new Set(
    DERIVED_CUSTOMER_PROPERTY_NAMES.map((n) => propertiesByName[n]?.id).filter(
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

export function buildCustomerPropertyDiff(input: {
  before: CustomerDomain;
  write: CustomerWriteInput;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  const afterDomain: Omit<CustomerDomain, "notionPageId" | "inTrash"> = {
    externalId: input.before.externalId,
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
    // 導出は維持(ユーザー書込対象外)
    latestActivitySummary: input.before.latestActivitySummary,
    lastActivityAt: input.before.lastActivityAt,
    nextAction: input.before.nextAction,
    nextActionDate: input.before.nextActionDate,
    expectedAmount: input.before.expectedAmount,
    isArchived: input.write.isArchived,
  };

  const beforeProps = customerToNotionProperties({
    customer: {
      externalId: input.before.externalId,
      displayName: input.before.displayName,
      legalName: input.before.legalName,
      officeName: input.before.officeName,
      postalCode: input.before.postalCode,
      prefecture: input.before.prefecture,
      city: input.before.city,
      addressLine: input.before.addressLine,
      phone: input.before.phone,
      email: input.before.email,
      representativeName: input.before.representativeName,
      website: input.before.website,
      businessCategoryPageIds: input.before.businessCategoryPageIds,
      tagPageIds: input.before.tagPageIds,
      salesStatusPageId: input.before.salesStatusPageId,
      acquisitionRoutePageId: input.before.acquisitionRoutePageId,
      priorityPageId: input.before.priorityPageId,
      staffPageIds: input.before.staffPageIds,
      relatedAccountPageIds: input.before.relatedAccountPageIds,
      latestActivitySummary: input.before.latestActivitySummary,
      lastActivityAt: input.before.lastActivityAt,
      nextAction: input.before.nextAction,
      nextActionDate: input.before.nextActionDate,
      expectedAmount: input.before.expectedAmount,
      isArchived: input.before.isArchived,
    },
    propertiesByName: input.propertiesByName,
  });

  const afterProps = customerToNotionProperties({
    customer: afterDomain,
    propertiesByName: input.propertiesByName,
  });

  // 導出プロパティは差分から除外
  const skipIds = new Set(
    DERIVED_CUSTOMER_PROPERTY_NAMES.map(
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

  // relation配列の同一性は別途確認済みでもJSONで拾える
  void sameIds;
  return diff;
}

export function buildChangedFieldsAudit(input: {
  before: CustomerDomain;
  write: CustomerWriteInput;
}): Record<string, { before: unknown; after: unknown }> {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const pairs: Array<[string, unknown, unknown]> = [
    ["表示名", input.before.displayName, input.write.displayName],
    ["法人名", input.before.legalName, input.write.legalName],
    ["事業所名", input.before.officeName, input.write.officeName],
    ["郵便番号", input.before.postalCode, input.write.postalCode],
    ["都道府県", input.before.prefecture, input.write.prefecture],
    ["市区町村", input.before.city, input.write.city],
    ["住所以降", input.before.addressLine, input.write.addressLine],
    ["電話番号", input.before.phone, input.write.phone],
    ["メールアドレス", input.before.email, input.write.email],
    ["代表者名", input.before.representativeName, input.write.representativeName],
    ["Webサイト", input.before.website, input.write.website],
    [
      "事業区分",
      input.before.businessCategoryPageIds,
      input.write.businessCategoryPageIds,
    ],
    ["タグ", input.before.tagPageIds, input.write.tagPageIds],
    ["営業ステータス", input.before.salesStatusPageId, input.write.salesStatusPageId],
    [
      "集客ルート",
      input.before.acquisitionRoutePageId,
      input.write.acquisitionRoutePageId,
    ],
    ["優先度", input.before.priorityPageId, input.write.priorityPageId],
    ["自社担当者", input.before.staffPageIds, input.write.staffPageIds],
    [
      "関連アカウント",
      input.before.relatedAccountPageIds,
      input.write.relatedAccountPageIds,
    ],
    ["アーカイブ", input.before.isArchived, input.write.isArchived],
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
  write: CustomerWriteInput,
  derived?: Partial<
    Pick<
      CustomerDomain,
      | "latestActivitySummary"
      | "lastActivityAt"
      | "nextAction"
      | "nextActionDate"
      | "expectedAmount"
    >
  >,
): Omit<CustomerDomain, "notionPageId" | "inTrash"> {
  return {
    externalId,
    displayName: write.displayName,
    legalName: write.legalName,
    officeName: write.officeName,
    postalCode: write.postalCode,
    prefecture: write.prefecture,
    city: write.city,
    addressLine: write.addressLine,
    phone: write.phone,
    email: write.email,
    representativeName: write.representativeName,
    website: write.website,
    businessCategoryPageIds: write.businessCategoryPageIds,
    tagPageIds: write.tagPageIds,
    salesStatusPageId: write.salesStatusPageId,
    acquisitionRoutePageId: write.acquisitionRoutePageId,
    priorityPageId: write.priorityPageId,
    staffPageIds: write.staffPageIds,
    relatedAccountPageIds: write.relatedAccountPageIds,
    latestActivitySummary: derived?.latestActivitySummary ?? null,
    lastActivityAt: derived?.lastActivityAt ?? null,
    nextAction: derived?.nextAction ?? null,
    nextActionDate: derived?.nextActionDate ?? null,
    expectedAmount: derived?.expectedAmount ?? null,
    isArchived: write.isArchived,
  };
}

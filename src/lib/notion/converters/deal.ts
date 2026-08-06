import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

export type DealDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  title: string;
  customerPageId: string | null;
  contactPageIds: string[];
  businessCategoryPageId: string | null;
  productName: string | null;
  stagePageId: string | null;
  staffPageIds: string[];
  expectedAmount: number | null;
  contractAmount: number | null;
  probability: number | null;
  expectedCloseDate: string | null;
  contractedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** 導出キャッシュ。ユーザー書込対象外 */
  nextAction: string | null;
  /** 導出キャッシュ。ユーザー書込対象外 */
  nextActionDate: string | null;
  lostReason: string | null;
  statusPageId: string | null;
  note: string | null;
};

type NotionPageLike = {
  id: string;
  in_trash?: boolean;
  archived?: boolean;
  properties: Record<string, NotionProp>;
};

type NotionProp = {
  id?: string;
  type: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  number?: number | null;
  date?: { start?: string | null; end?: string | null } | null;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Notion Page → Deal domain(property ID方式)。
 */
export async function notionPageToDeal(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
}): Promise<DealDomain> {
  const props = indexByPropertyId(input.page.properties);
  const byName = input.propertiesByName;

  const externalId = richText(propByName(props, byName, "external_id"));
  if (!externalId) {
    throw new Error("external_idは必須です");
  }
  if (input.page.archived) {
    throw new Error("archivedは使用禁止。in_trashを参照すること");
  }

  const rel = async (name: string) =>
    resolveRelationIds({
      pageId: input.page.id,
      propertyId: byName[name]!.id,
      value: propByName(props, byName, name) as never,
      pager: input.pager,
    });

  const singleRel = async (name: string) => {
    const ids = await rel(name);
    if (ids.length > 1) {
      throw new Error(`${name} は単一relationですが ${ids.length} 件あります`);
    }
    return ids[0] ?? null;
  };

  const period = propByName(props, byName, "契約期間")?.date ?? null;

  return {
    notionPageId: input.page.id,
    externalId,
    inTrash: Boolean(input.page.in_trash),
    title: title(propByName(props, byName, "案件名")),
    customerPageId: await singleRel("顧客アカウント"),
    contactPageIds: await rel("顧客担当者"),
    businessCategoryPageId: await singleRel("事業区分"),
    productName: richText(propByName(props, byName, "商材")) || null,
    stagePageId: await singleRel("営業ステージ"),
    staffPageIds: await rel("自社担当者"),
    expectedAmount: numberOrNull(propByName(props, byName, "見込み金額")),
    contractAmount: numberOrNull(propByName(props, byName, "契約金額")),
    probability: numberOrNull(propByName(props, byName, "確度")),
    expectedCloseDate: dateStart(propByName(props, byName, "受注予定日")),
    contractedAt: dateStart(propByName(props, byName, "契約日")),
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    nextAction: richText(propByName(props, byName, "次回アクション")) || null,
    nextActionDate: dateStart(propByName(props, byName, "次回予定日")),
    lostReason: richText(propByName(props, byName, "失注理由")) || null,
    statusPageId: await singleRel("ステータス"),
    note: richText(propByName(props, byName, "備考")) || null,
  };
}

/**
 * Deal domain → Notion properties(property IDキー)。
 * 導出プロパティも含む(送出時は omitDerivedDealProperties で除外)。
 */
export function dealToNotionProperties(input: {
  deal: Omit<DealDomain, "notionPageId" | "inTrash">;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.deal.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("案件名")]: {
      title: [{ text: { content: input.deal.title } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.deal.externalId } }],
    },
    [id("顧客アカウント")]: relation(
      input.deal.customerPageId ? [input.deal.customerPageId] : [],
    ),
    [id("顧客担当者")]: relation(input.deal.contactPageIds),
    [id("事業区分")]: relation(
      input.deal.businessCategoryPageId
        ? [input.deal.businessCategoryPageId]
        : [],
    ),
    [id("商材")]: rich(input.deal.productName),
    [id("営業ステージ")]: relation(
      input.deal.stagePageId ? [input.deal.stagePageId] : [],
    ),
    [id("自社担当者")]: relation(input.deal.staffPageIds),
    [id("見込み金額")]: { number: input.deal.expectedAmount },
    [id("契約金額")]: { number: input.deal.contractAmount },
    [id("確度")]: { number: input.deal.probability },
    [id("受注予定日")]: date(input.deal.expectedCloseDate),
    [id("契約日")]: date(input.deal.contractedAt),
    [id("契約期間")]: dateRange(input.deal.periodStart, input.deal.periodEnd),
    [id("次回アクション")]: rich(input.deal.nextAction),
    [id("次回予定日")]: date(input.deal.nextActionDate),
    [id("失注理由")]: rich(input.deal.lostReason),
    [id("ステータス")]: relation(
      input.deal.statusPageId ? [input.deal.statusPageId] : [],
    ),
    [id("備考")]: rich(input.deal.note),
  };
}

function indexByPropertyId(
  properties: Record<string, NotionProp>,
): Record<string, NotionProp> {
  const byId: Record<string, NotionProp> = {};
  for (const prop of Object.values(properties)) {
    if (prop.id) byId[prop.id] = prop;
  }
  return { ...properties, ...byId };
}

function propByName(
  props: Record<string, NotionProp>,
  map: PropertyIdMap,
  name: string,
): NotionProp | undefined {
  const meta = map[name];
  if (!meta) throw new Error(`スナップショットにプロパティがありません: ${name}`);
  return props[meta.id] ?? props[name];
}

function title(prop?: NotionProp): string {
  return prop?.title?.map((t) => t.plain_text ?? "").join("") ?? "";
}
function richText(prop?: NotionProp): string {
  return prop?.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";
}
function numberOrNull(prop?: NotionProp): number | null {
  const n = prop?.number;
  return typeof n === "number" ? n : null;
}
function dateStart(prop?: NotionProp): string | null {
  return prop?.date?.start ?? null;
}
function rich(value: string | null | undefined) {
  return {
    rich_text: value ? [{ text: { content: value } }] : [],
  };
}
function relation(ids: string[]) {
  return { relation: ids.map((id) => ({ id })) };
}
function date(value: string | null | undefined) {
  return { date: value ? { start: value } : null };
}
function dateRange(start: string | null, end: string | null) {
  if (!start && !end) return { date: null };
  const s = start ?? end!;
  return {
    date: {
      start: s,
      ...(end ? { end } : {}),
    },
  };
}

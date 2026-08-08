import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";

export type CustomerDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  displayName: string;
  legalName: string | null;
  officeName: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  representativeName: string | null;
  website: string | null;
  businessCategoryPageIds: string[];
  tagPageIds: string[];
  /** Notion masters「関係性」（product: Organization relationships） */
  relationshipPageIds: string[];
  salesStatusPageId: string | null;
  acquisitionRoutePageId: string | null;
  priorityPageId: string | null;
  staffPageIds: string[];
  relatedAccountPageIds: string[];
  latestActivitySummary: string | null;
  lastActivityAt: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  expectedAmount: number | null;
  isArchived: boolean;
};

export type PropertyIdMap = Record<string, { id: string; type: string }>;

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
  select?: { name?: string } | null;
  email?: string | null;
  phone_number?: string | null;
  url?: string | null;
  number?: number | null;
  checkbox?: boolean;
  date?: { start?: string | null } | null;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Notion Page → Customer domain(property ID方式)。
 */
export async function notionPageToCustomer(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
}): Promise<CustomerDomain> {
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

  return {
    notionPageId: input.page.id,
    externalId,
    inTrash: Boolean(input.page.in_trash),
    displayName: title(propByName(props, byName, "表示名")),
    legalName: richText(propByName(props, byName, "法人名")) || null,
    officeName: richText(propByName(props, byName, "事業所名")) || null,
    postalCode: richText(propByName(props, byName, "郵便番号")) || null,
    prefecture: selectName(propByName(props, byName, "都道府県")),
    city: richText(propByName(props, byName, "市区町村")) || null,
    addressLine: richText(propByName(props, byName, "住所以降")) || null,
    phone: propByName(props, byName, "電話番号")?.phone_number ?? null,
    email: propByName(props, byName, "メールアドレス")?.email ?? null,
    representativeName:
      richText(propByName(props, byName, "代表者名")) || null,
    website: propByName(props, byName, "Webサイト")?.url ?? null,
    businessCategoryPageIds: await rel("事業区分"),
    tagPageIds: await rel("タグ"),
    relationshipPageIds: byName["関係性"] ? await rel("関係性") : [],
    salesStatusPageId: await singleRel("営業ステータス"),
    acquisitionRoutePageId: await singleRel("集客ルート"),
    priorityPageId: await singleRel("優先度"),
    staffPageIds: await rel("自社担当者"),
    relatedAccountPageIds: await rel("関連アカウント"),
    latestActivitySummary:
      richText(propByName(props, byName, "最新対応内容")) || null,
    lastActivityAt: dateStart(propByName(props, byName, "最終対応日")),
    nextAction: richText(propByName(props, byName, "次回アクション")) || null,
    nextActionDate: dateStart(propByName(props, byName, "次回予定日")),
    expectedAmount: propByName(props, byName, "見込み金額")?.number ?? null,
    isArchived: Boolean(propByName(props, byName, "アーカイブ")?.checkbox),
  };
}

/**
 * Customer domain → Notion properties(property IDキー)。
 * ページ本文は扱わない(顧客に長文本文要件なし)。
 */
export function customerToNotionProperties(input: {
  customer: Omit<CustomerDomain, "notionPageId" | "inTrash">;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.customer.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("表示名")]: {
      title: [{ text: { content: input.customer.displayName } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.customer.externalId } }],
    },
    [id("法人名")]: rich(input.customer.legalName),
    [id("事業所名")]: rich(input.customer.officeName),
    [id("郵便番号")]: rich(input.customer.postalCode),
    [id("都道府県")]: input.customer.prefecture
      ? { select: { name: input.customer.prefecture } }
      : { select: null },
    [id("市区町村")]: rich(input.customer.city),
    [id("住所以降")]: rich(input.customer.addressLine),
    [id("電話番号")]: { phone_number: input.customer.phone },
    [id("メールアドレス")]: { email: input.customer.email },
    [id("代表者名")]: rich(input.customer.representativeName),
    [id("Webサイト")]: { url: input.customer.website },
    [id("事業区分")]: relation(input.customer.businessCategoryPageIds),
    [id("タグ")]: relation(input.customer.tagPageIds),
    ...(input.propertiesByName["関係性"]
      ? {
          [id("関係性")]: relation(input.customer.relationshipPageIds),
        }
      : {}),
    [id("営業ステータス")]: relation(
      input.customer.salesStatusPageId ? [input.customer.salesStatusPageId] : [],
    ),
    [id("集客ルート")]: relation(
      input.customer.acquisitionRoutePageId
        ? [input.customer.acquisitionRoutePageId]
        : [],
    ),
    [id("優先度")]: relation(
      input.customer.priorityPageId ? [input.customer.priorityPageId] : [],
    ),
    [id("自社担当者")]: relation(input.customer.staffPageIds),
    [id("関連アカウント")]: relation(input.customer.relatedAccountPageIds),
    [id("最新対応内容")]: rich(input.customer.latestActivitySummary),
    [id("最終対応日")]: date(input.customer.lastActivityAt),
    [id("次回アクション")]: rich(input.customer.nextAction),
    [id("次回予定日")]: date(input.customer.nextActionDate),
    [id("見込み金額")]: { number: input.customer.expectedAmount },
    [id("アーカイブ")]: { checkbox: input.customer.isArchived },
  };
}

function indexByPropertyId(
  properties: Record<string, NotionProp>,
): Record<string, NotionProp> {
  const byId: Record<string, NotionProp> = {};
  for (const prop of Object.values(properties)) {
    if (prop.id) byId[prop.id] = prop;
  }
  // 名前キーも残す(テスト容易性)
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
function selectName(prop?: NotionProp): string | null {
  return prop?.select?.name ?? null;
}
function dateStart(prop?: NotionProp): string | null {
  return prop?.date?.start ?? null;
}
function rich(value: string | null | undefined) {
  return {
    rich_text: value ? [{ text: { content: value } }] : [],
  };
}
function date(value: string | null | undefined) {
  return { date: value ? { start: value } : null };
}
function relation(ids: string[]) {
  return { relation: ids.map((id) => ({ id })) };
}

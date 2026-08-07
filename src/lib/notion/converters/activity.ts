import {
  extractManagedBody,
  hashActivityBody,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

/**
 * 対応履歴ドメイン。
 * 本文はページブロック(管理セクション)。自社担当者 relation は存在しない。
 */
export type ActivityDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  title: string;
  customerPageId: string | null;
  dealPageId: string | null;
  contactPageIds: string[];
  activityAt: string | null;
  categoryPageIds: string[];
  summary: string | null;
  nextActionNote: string | null;
  nextActionDate: string | null;
  createdById: string | null;
  createdByName: string | null;
  updatedById: string | null;
  updatedByName: string | null;
  batchId: string | null;
  body: string;
  bodyVersion: number | null;
  bodyHash: string;
  managedBlockIds: string[];
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
  date?: { start?: string | null; end?: string | null } | null;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Notion Page(+任意で本文ブロック) → Activity domain(property ID方式)。
 */
export async function notionPageToActivity(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
  /** 省略時は本文空・version null(詳細読取では必ず渡す) */
  blocks?: NotionBlockLike[];
}): Promise<ActivityDomain> {
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

  const managed =
    input.blocks !== undefined ? extractManagedBody(input.blocks) : null;
  const body = managed?.body ?? "";
  const bodyVersion = managed?.bodyVersion ?? null;
  const managedBlockIds = managed?.managedBlockIds ?? [];
  const bodyHash = hashActivityBody(body);

  return {
    notionPageId: input.page.id,
    externalId,
    inTrash: Boolean(input.page.in_trash),
    title: title(propByName(props, byName, "タイトル")),
    customerPageId: await singleRel("顧客アカウント"),
    dealPageId: await singleRel("関連案件"),
    contactPageIds: await rel("顧客担当者"),
    activityAt: dateStart(propByName(props, byName, "対応日時")),
    categoryPageIds: await rel("対応分類"),
    summary: richText(propByName(props, byName, "要約")) || null,
    nextActionNote:
      richText(propByName(props, byName, "次回アクション(入力記録)")) || null,
    nextActionDate: dateStart(
      propByName(props, byName, "次回予定日(入力記録)"),
    ),
    createdById: richText(propByName(props, byName, "登録者ID")) || null,
    createdByName: richText(propByName(props, byName, "登録者名")) || null,
    updatedById: richText(propByName(props, byName, "最終編集者ID")) || null,
    updatedByName: richText(propByName(props, byName, "最終編集者名")) || null,
    batchId: richText(propByName(props, byName, "batch_id")) || null,
    body,
    bodyVersion,
    bodyHash,
    managedBlockIds,
  };
}

/**
 * Activity domain → Notion properties(property IDキー)。
 * 本文ブロックは含めない。
 */
export function activityToNotionProperties(input: {
  activity: Omit<
    ActivityDomain,
    "notionPageId" | "inTrash" | "body" | "bodyVersion" | "bodyHash" | "managedBlockIds"
  >;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.activity.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("タイトル")]: {
      title: [{ text: { content: input.activity.title } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.activity.externalId } }],
    },
    [id("顧客アカウント")]: relation(
      input.activity.customerPageId ? [input.activity.customerPageId] : [],
    ),
    [id("関連案件")]: relation(
      input.activity.dealPageId ? [input.activity.dealPageId] : [],
    ),
    [id("顧客担当者")]: relation(input.activity.contactPageIds),
    [id("対応日時")]: date(input.activity.activityAt),
    [id("対応分類")]: relation(input.activity.categoryPageIds),
    [id("要約")]: rich(input.activity.summary),
    [id("次回アクション(入力記録)")]: rich(input.activity.nextActionNote),
    [id("次回予定日(入力記録)")]: date(input.activity.nextActionDate),
    [id("登録者ID")]: rich(input.activity.createdById),
    [id("登録者名")]: rich(input.activity.createdByName),
    [id("最終編集者ID")]: rich(input.activity.updatedById),
    [id("最終編集者名")]: rich(input.activity.updatedByName),
    [id("batch_id")]: rich(input.activity.batchId),
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

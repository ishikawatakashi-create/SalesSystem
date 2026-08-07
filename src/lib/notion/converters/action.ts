import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

/**
 * 次回アクションドメイン。
 * 自社担当者は単一。先方担当者プロパティは存在しない。
 */
export type ActionDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  title: string;
  customerPageId: string | null;
  dealPageId: string | null;
  activityPageId: string | null;
  staffPageId: string | null;
  dueDate: string | null;
  statusPageId: string | null;
  priorityPageId: string | null;
  completedAt: string | null;
  createdById: string | null;
  createdByName: string | null;
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

export async function notionPageToAction(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
}): Promise<ActionDomain> {
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
    title: title(propByName(props, byName, "アクション内容")),
    customerPageId: await singleRel("顧客アカウント"),
    dealPageId: await singleRel("案件"),
    activityPageId: await singleRel("元対応履歴"),
    staffPageId: await singleRel("自社担当者"),
    dueDate: dateStart(propByName(props, byName, "期限")),
    statusPageId: await singleRel("状態"),
    priorityPageId: await singleRel("優先度"),
    completedAt: dateStart(propByName(props, byName, "完了日時")),
    createdById: richText(propByName(props, byName, "作成者ID")) || null,
    createdByName: richText(propByName(props, byName, "作成者名")) || null,
  };
}

export function actionToNotionProperties(input: {
  action: Omit<ActionDomain, "notionPageId" | "inTrash">;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.action.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("アクション内容")]: {
      title: [{ text: { content: input.action.title } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.action.externalId } }],
    },
    [id("顧客アカウント")]: relation(
      input.action.customerPageId ? [input.action.customerPageId] : [],
    ),
    [id("案件")]: relation(
      input.action.dealPageId ? [input.action.dealPageId] : [],
    ),
    [id("元対応履歴")]: relation(
      input.action.activityPageId ? [input.action.activityPageId] : [],
    ),
    [id("自社担当者")]: relation(
      input.action.staffPageId ? [input.action.staffPageId] : [],
    ),
    [id("期限")]: date(input.action.dueDate),
    [id("状態")]: relation(
      input.action.statusPageId ? [input.action.statusPageId] : [],
    ),
    [id("優先度")]: relation(
      input.action.priorityPageId ? [input.action.priorityPageId] : [],
    ),
    [id("完了日時")]: date(input.action.completedAt),
    [id("作成者ID")]: rich(input.action.createdById),
    [id("作成者名")]: rich(input.action.createdByName),
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

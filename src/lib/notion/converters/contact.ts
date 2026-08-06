import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

export type ContactDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  name: string;
  nameKana: string | null;
  customerPageId: string | null;
  department: string | null;
  /** 役職 */
  title: string | null;
  phone: string | null;
  email: string | null;
  contactTypePageId: string | null;
  note: string | null;
  isActive: boolean;
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
  email?: string | null;
  phone_number?: string | null;
  checkbox?: boolean;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Notion Page → Contact domain(property ID方式)。
 */
export async function notionPageToContact(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
}): Promise<ContactDomain> {
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
    name: title(propByName(props, byName, "氏名")),
    nameKana: richText(propByName(props, byName, "氏名よみ")) || null,
    customerPageId: await singleRel("所属アカウント"),
    department: richText(propByName(props, byName, "部署")) || null,
    title: richText(propByName(props, byName, "役職")) || null,
    phone: propByName(props, byName, "電話番号")?.phone_number ?? null,
    email: propByName(props, byName, "メールアドレス")?.email ?? null,
    contactTypePageId: await singleRel("区分"),
    note: richText(propByName(props, byName, "備考")) || null,
    isActive: Boolean(propByName(props, byName, "有効")?.checkbox),
  };
}

/**
 * Contact domain → Notion properties(property IDキー)。
 */
export function contactToNotionProperties(input: {
  contact: Omit<ContactDomain, "notionPageId" | "inTrash">;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.contact.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("氏名")]: {
      title: [{ text: { content: input.contact.name } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.contact.externalId } }],
    },
    [id("氏名よみ")]: rich(input.contact.nameKana),
    [id("所属アカウント")]: relation(
      input.contact.customerPageId ? [input.contact.customerPageId] : [],
    ),
    [id("部署")]: rich(input.contact.department),
    [id("役職")]: rich(input.contact.title),
    [id("電話番号")]: { phone_number: input.contact.phone },
    [id("メールアドレス")]: { email: input.contact.email },
    [id("区分")]: relation(
      input.contact.contactTypePageId ? [input.contact.contactTypePageId] : [],
    ),
    [id("備考")]: rich(input.contact.note),
    [id("有効")]: { checkbox: input.contact.isActive },
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
function rich(value: string | null | undefined) {
  return {
    rich_text: value ? [{ text: { content: value } }] : [],
  };
}
function relation(ids: string[]) {
  return { relation: ids.map((id) => ({ id })) };
}

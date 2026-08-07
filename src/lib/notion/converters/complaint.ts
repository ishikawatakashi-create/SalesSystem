import {
  extractManagedComplaintBody,
  hashComplaintBody,
  type ComplaintBodySections,
  type NotionBlockLike,
} from "@/lib/notion/converters/page-body";
import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

/**
 * クレームドメイン。
 * 詳細本文はページブロック(4見出し)。contact relation は無い。
 */
export type ComplaintDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  title: string;
  customerPageId: string | null;
  dealPageId: string | null;
  severityPageId: string | null;
  statusPageId: string | null;
  staffPageId: string | null;
  occurredOn: string | null;
  summary: string | null;
  dueDate: string | null;
  completedOn: string | null;
  note: string | null;
  content: string | null;
  cause: string | null;
  response: string | null;
  prevention: string | null;
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
 * Notion Page(+任意で本文ブロック) → Complaint domain(property ID方式)。
 */
export async function notionPageToComplaint(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
  /** 省略時は本文空・version null(詳細読取では必ず渡す) */
  blocks?: NotionBlockLike[];
}): Promise<ComplaintDomain> {
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
    input.blocks !== undefined
      ? extractManagedComplaintBody(input.blocks)
      : null;
  const sections: ComplaintBodySections = managed?.sections ?? {
    content: null,
    cause: null,
    response: null,
    prevention: null,
  };
  const bodyVersion = managed?.bodyVersion ?? null;
  const managedBlockIds = managed?.managedBlockIds ?? [];
  const bodyHash = hashComplaintBody(sections);

  return {
    notionPageId: input.page.id,
    externalId,
    inTrash: Boolean(input.page.in_trash),
    title: title(propByName(props, byName, "タイトル")),
    customerPageId: await singleRel("顧客アカウント"),
    dealPageId: await singleRel("関連案件"),
    severityPageId: await singleRel("重要度"),
    statusPageId: await singleRel("対応状況"),
    staffPageId: await singleRel("対応責任者"),
    occurredOn: dateStart(propByName(props, byName, "発生日")),
    summary: richText(propByName(props, byName, "概要")) || null,
    dueDate: dateStart(propByName(props, byName, "対応期限")),
    completedOn: dateStart(propByName(props, byName, "完了日")),
    note: richText(propByName(props, byName, "備考")) || null,
    content: sections.content,
    cause: sections.cause,
    response: sections.response,
    prevention: sections.prevention,
    bodyVersion,
    bodyHash,
    managedBlockIds,
  };
}

/**
 * Complaint domain → Notion properties(property IDキー)。
 * 本文ブロックは含めない。
 */
export function complaintToNotionProperties(input: {
  complaint: Omit<
    ComplaintDomain,
    | "notionPageId"
    | "inTrash"
    | "content"
    | "cause"
    | "response"
    | "prevention"
    | "bodyVersion"
    | "bodyHash"
    | "managedBlockIds"
  >;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.complaint.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("タイトル")]: {
      title: [{ text: { content: input.complaint.title } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.complaint.externalId } }],
    },
    [id("顧客アカウント")]: relation(
      input.complaint.customerPageId ? [input.complaint.customerPageId] : [],
    ),
    [id("関連案件")]: relation(
      input.complaint.dealPageId ? [input.complaint.dealPageId] : [],
    ),
    [id("重要度")]: relation(
      input.complaint.severityPageId ? [input.complaint.severityPageId] : [],
    ),
    [id("対応状況")]: relation(
      input.complaint.statusPageId ? [input.complaint.statusPageId] : [],
    ),
    [id("対応責任者")]: relation(
      input.complaint.staffPageId ? [input.complaint.staffPageId] : [],
    ),
    [id("発生日")]: date(input.complaint.occurredOn),
    [id("概要")]: rich(input.complaint.summary),
    [id("対応期限")]: date(input.complaint.dueDate),
    [id("完了日")]: date(input.complaint.completedOn),
    [id("備考")]: rich(input.complaint.note),
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

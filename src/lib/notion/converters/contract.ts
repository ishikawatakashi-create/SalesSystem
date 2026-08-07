import { resolveRelationIds, type PagePropertyPager } from "@/lib/notion/converters/relations";
import type { PropertyIdMap } from "@/lib/notion/converters/customer";

export type { PropertyIdMap };

/** Notion files プロパティの読取メタデータ(書込アップロードは対象外) */
export type ContractFileMeta = {
  name: string;
  url: string | null;
  type: "file" | "external";
};

/**
 * 契約ドメイン。
 * 契約書ファイルは読取のみ(メタデータ / hasContractFile)。contact relation は無い。
 */
export type ContractDomain = {
  notionPageId: string;
  externalId: string;
  inTrash: boolean;
  title: string;
  customerPageId: string | null;
  dealPageId: string | null;
  contractTypePageId: string | null;
  tradeTypePageId: string | null;
  paymentStatusPageId: string | null;
  statusPageId: string | null;
  staffPageIds: string[];
  amount: number | null;
  contractedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  billingTerms: string | null;
  contractUrl: string | null;
  contractFiles: ContractFileMeta[];
  hasContractFile: boolean;
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
  checkbox?: boolean;
  url?: string | null;
  date?: { start?: string | null; end?: string | null } | null;
  files?: Array<{
    name?: string;
    type?: string;
    file?: { url?: string };
    external?: { url?: string };
  }>;
  relation?: Array<{ id: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Notion Page → Contract domain(property ID方式)。
 */
export async function notionPageToContract(input: {
  page: NotionPageLike;
  propertiesByName: PropertyIdMap;
  pager: PagePropertyPager;
}): Promise<ContractDomain> {
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

  const contractFiles = filesMeta(propByName(props, byName, "契約書ファイル"));

  return {
    notionPageId: input.page.id,
    externalId,
    inTrash: Boolean(input.page.in_trash),
    title: title(propByName(props, byName, "契約名")),
    customerPageId: await singleRel("顧客アカウント"),
    dealPageId: await singleRel("関連案件"),
    contractTypePageId: await singleRel("契約区分"),
    tradeTypePageId: await singleRel("取引区分"),
    paymentStatusPageId: await singleRel("支払状況"),
    statusPageId: await singleRel("状態"),
    staffPageIds: await rel("担当者"),
    amount: numberOrNull(propByName(props, byName, "契約金額")),
    contractedAt: dateStart(propByName(props, byName, "契約日")),
    startDate: dateStart(propByName(props, byName, "契約開始日")),
    endDate: dateStart(propByName(props, byName, "契約終了日")),
    autoRenew: Boolean(propByName(props, byName, "自動更新")?.checkbox),
    billingTerms: richText(propByName(props, byName, "請求条件")) || null,
    contractUrl: urlOrNull(propByName(props, byName, "契約書URL")),
    contractFiles,
    hasContractFile: contractFiles.length > 0,
    note: richText(propByName(props, byName, "備考")) || null,
  };
}

/**
 * Contract domain → Notion properties(property IDキー)。
 * 契約書ファイル(files)は送出しない(更新時も既存を維持)。
 */
export function contractToNotionProperties(input: {
  contract: Omit<
    ContractDomain,
    "notionPageId" | "inTrash" | "contractFiles" | "hasContractFile"
  >;
  propertiesByName: PropertyIdMap;
}): Record<string, unknown> {
  if (!input.contract.externalId) {
    throw new Error("external_idは必須です");
  }
  const id = (name: string) => {
    const p = input.propertiesByName[name];
    if (!p) throw new Error(`property ID未解決: ${name}`);
    return p.id;
  };

  return {
    [id("契約名")]: {
      title: [{ text: { content: input.contract.title } }],
    },
    [id("external_id")]: {
      rich_text: [{ text: { content: input.contract.externalId } }],
    },
    [id("顧客アカウント")]: relation(
      input.contract.customerPageId ? [input.contract.customerPageId] : [],
    ),
    [id("関連案件")]: relation(
      input.contract.dealPageId ? [input.contract.dealPageId] : [],
    ),
    [id("契約区分")]: relation(
      input.contract.contractTypePageId
        ? [input.contract.contractTypePageId]
        : [],
    ),
    [id("取引区分")]: relation(
      input.contract.tradeTypePageId ? [input.contract.tradeTypePageId] : [],
    ),
    [id("支払状況")]: relation(
      input.contract.paymentStatusPageId
        ? [input.contract.paymentStatusPageId]
        : [],
    ),
    [id("状態")]: relation(
      input.contract.statusPageId ? [input.contract.statusPageId] : [],
    ),
    [id("担当者")]: relation(input.contract.staffPageIds),
    [id("契約金額")]: { number: input.contract.amount },
    [id("契約日")]: date(input.contract.contractedAt),
    [id("契約開始日")]: date(input.contract.startDate),
    [id("契約終了日")]: date(input.contract.endDate),
    [id("自動更新")]: { checkbox: input.contract.autoRenew },
    [id("請求条件")]: rich(input.contract.billingTerms),
    [id("契約書URL")]: { url: input.contract.contractUrl },
    [id("備考")]: rich(input.contract.note),
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
function urlOrNull(prop?: NotionProp): string | null {
  const u = prop?.url;
  return typeof u === "string" && u.trim() ? u : null;
}
function filesMeta(prop?: NotionProp): ContractFileMeta[] {
  const files = prop?.files ?? [];
  return files.map((f) => {
    const type = f.type === "external" ? "external" : "file";
    const url =
      type === "external"
        ? (f.external?.url ?? null)
        : (f.file?.url ?? null);
    return {
      name: f.name ?? "",
      url,
      type,
    };
  });
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

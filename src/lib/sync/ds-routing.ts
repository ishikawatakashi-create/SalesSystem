import type { NotionDbKey } from "@/lib/notion/schema/databases";

export type SyncEntityKey = Exclude<NotionDbKey, "staff">;

const ENV_BY_ENTITY: Record<SyncEntityKey, string> = {
  customers: "NOTION_DS_CUSTOMERS",
  contacts: "NOTION_DS_CONTACTS",
  deals: "NOTION_DS_DEALS",
  activities: "NOTION_DS_ACTIVITIES",
  contracts: "NOTION_DS_CONTRACTS",
  complaints: "NOTION_DS_COMPLAINTS",
  actions: "NOTION_DS_ACTIONS",
  masters: "NOTION_DS_MASTERS",
};

export type DataSourceEnvMap = Partial<Record<SyncEntityKey, string>>;

/** 環境変数から DS ID → entity マップを構築 */
export function loadDataSourceEnvMap(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceEnvMap {
  const map: DataSourceEnvMap = {};
  for (const [entity, envKey] of Object.entries(ENV_BY_ENTITY) as Array<
    [SyncEntityKey, string]
  >) {
    const value = env[envKey]?.trim();
    if (value) map[entity] = value;
  }
  return map;
}

export function resolveEntityByDataSourceId(
  dataSourceId: string | null | undefined,
  envMap: DataSourceEnvMap = loadDataSourceEnvMap(),
): SyncEntityKey | null {
  if (!dataSourceId) return null;
  for (const [entity, dsId] of Object.entries(envMap) as Array<
    [SyncEntityKey, string]
  >) {
    if (dsId === dataSourceId) return entity;
  }
  return null;
}

type NotionParentLike = {
  type?: string;
  data_source_id?: string;
  database_id?: string;
};

/** page.parent または webhook entity から data_source_id を抽出 */
export function extractDataSourceId(input: {
  pageParent?: NotionParentLike | null;
  entity?: { id?: string; type?: string } | null;
  payloadDataSourceId?: string | null;
}): string | null {
  if (input.payloadDataSourceId) return input.payloadDataSourceId;
  if (input.pageParent?.type === "data_source_id" && input.pageParent.data_source_id) {
    return input.pageParent.data_source_id;
  }
  if (input.entity?.type === "data_source" && input.entity.id) {
    return input.entity.id;
  }
  return null;
}

export const INDEX_TABLE_BY_ENTITY: Record<
  Exclude<SyncEntityKey, "masters">,
  string
> = {
  customers: "customer_index",
  contacts: "contact_index",
  deals: "deal_index",
  activities: "activity_index",
  contracts: "contract_index",
  complaints: "complaint_index",
  actions: "action_index",
};

export const ALL_INDEX_TABLES = [
  "customer_index",
  "contact_index",
  "deal_index",
  "activity_index",
  "contract_index",
  "complaint_index",
  "action_index",
  "masters_cache",
] as const;

export type IndexTableName = (typeof ALL_INDEX_TABLES)[number];

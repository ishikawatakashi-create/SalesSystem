export type SearchEntity =
  | "customers"
  | "contacts"
  | "deals"
  | "activities"
  | "actions"
  | "contracts"
  | "complaints";

export const SEARCH_ENTITY_LABELS: Record<SearchEntity, string> = {
  customers: "顧客",
  contacts: "担当者",
  deals: "案件",
  activities: "対応履歴",
  actions: "次回アクション",
  contracts: "契約",
  complaints: "クレーム",
};

export const SEARCH_ENTITIES: SearchEntity[] = [
  "customers",
  "contacts",
  "deals",
  "activities",
  "actions",
  "contracts",
  "complaints",
];

export type GlobalSearchHit = {
  entity: SearchEntity;
  pageId: string;
  title: string;
  subtitle: string | null;
  href: string;
  /** 顧客のみ: アーカイブ表示用 */
  isArchived?: boolean;
};

export type GlobalSearchResult = {
  q: string;
  limitPerEntity: number;
  groups: Array<{
    entity: SearchEntity;
    label: string;
    hits: GlobalSearchHit[];
  }>;
  totalCount: number;
};

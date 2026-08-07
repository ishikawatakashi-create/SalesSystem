/**
 * CSV インポート対応エンティティ型定義。
 *
 * @see docs/csv-import-design.md
 */

export const IMPORT_ENTITIES = [
  "customers",
  "contacts",
  "deals",
  "activities",
  "actions",
  "contracts",
  "complaints",
] as const;

export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/**
 * インポート順序（依存関係に従う）。
 * 例: customers → contacts → deals → activities → actions → contracts → complaints
 */
export const IMPORT_ENTITY_ORDER: readonly ImportEntity[] = IMPORT_ENTITIES;

/**
 * エンティティの日本語表示名。
 */
export const ENTITY_DISPLAY_NAMES: Record<ImportEntity, string> = {
  customers: "顧客アカウント",
  contacts: "顧客担当者",
  deals: "案件",
  activities: "対応履歴",
  actions: "次回アクション",
  contracts: "契約",
  complaints: "クレーム",
};

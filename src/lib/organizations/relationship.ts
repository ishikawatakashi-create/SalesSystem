/**
 * Product: Organization relationships（Notion masters「関係性」）。
 * Technical entity は customer のまま。
 */

export const ORGANIZATION_RELATIONSHIP_MASTER_TYPE = "関係性";

/** Notion customers DB の relation プロパティ名 */
export const ORGANIZATION_RELATIONSHIP_PROPERTY = "関係性";

/** 初期 semantic_key（将来 master 追加で増やせる。ハードコードは主要キーのみ） */
export const ORGANIZATION_RELATIONSHIP_SEEDS = [
  { semanticKey: "customer", name: "顧客", sortOrder: 10 },
  { semanticKey: "prospect", name: "見込顧客", sortOrder: 20 },
  { semanticKey: "media", name: "メディア", sortOrder: 30 },
  { semanticKey: "municipality", name: "自治体", sortOrder: 40 },
  { semanticKey: "education_research", name: "学校・研究機関", sortOrder: 50 },
  { semanticKey: "partner", name: "パートナー", sortOrder: 60 },
  { semanticKey: "supplier", name: "仕入先", sortOrder: 70 },
  { semanticKey: "other", name: "その他", sortOrder: 80 },
] as const;

export type OrganizationRelationshipSemanticKey =
  (typeof ORGANIZATION_RELATIONSHIP_SEEDS)[number]["semanticKey"];

export const DEFAULT_ORGANIZATION_RELATIONSHIP_SEMANTIC_KEY =
  "customer" as const satisfies OrganizationRelationshipSemanticKey;

/** ナビ / tabs で先に出す主要キー */
export const PRIMARY_ORGANIZATION_RELATIONSHIP_FILTERS: Array<{
  semanticKey: OrganizationRelationshipSemanticKey;
  label: string;
}> = [
  { semanticKey: "customer", label: "顧客" },
  { semanticKey: "prospect", label: "見込顧客" },
  { semanticKey: "media", label: "メディア" },
  { semanticKey: "municipality", label: "自治体" },
  { semanticKey: "education_research", label: "学校・研究" },
  { semanticKey: "partner", label: "パートナー" },
];

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  ORGANIZATION_RELATIONSHIP_SEEDS.map((s) => [s.semanticKey, s.name]),
);

export function organizationRelationshipLabel(
  semanticKey: string | null | undefined,
): string {
  if (!semanticKey) return "関係性未設定";
  return LABEL_BY_KEY[semanticKey] ?? semanticKey;
}

export function isKnownOrganizationRelationshipKey(key: string): boolean {
  return key in LABEL_BY_KEY;
}

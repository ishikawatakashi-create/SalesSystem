import { uuidV5 } from "@/lib/notion/ids";

export type InitialMasterSeed = {
  masterType: string;
  name: string;
  semanticKey?: string;
  semanticTags?: string[];
  sortOrder: number;
  color?: string;
  isActive: boolean;
  /** 適用事業区分の名称参照(空=全区分) */
  applicableCategoryNames?: string[];
};

/**
 * docs/notion-schema.md §8 初期データ。
 * external_idは master:{種別}:{名称} から決定的に生成。
 */
export const INITIAL_MASTERS: InitialMasterSeed[] = [
  // 事業区分
  m("事業区分", "介護福祉(インソール)", 10),
  m("事業区分", "AIセミナー", 20),
  // 営業ステータス
  m("営業ステータス", "未接触", 10, { semanticKey: "untouched" }),
  m("営業ステータス", "接触予定", 20, { semanticKey: "planned_contact" }),
  m("営業ステータス", "接触中", 30, { semanticKey: "contacting" }),
  m("営業ステータス", "担当者接続", 40, { semanticKey: "connected" }),
  m("営業ステータス", "アポイント獲得", 50, { semanticKey: "appointment" }),
  m("営業ステータス", "商談中", 60, { semanticKey: "negotiating" }),
  m("営業ステータス", "提案・見積", 70, { semanticKey: "proposal" }),
  m("営業ステータス", "検討中", 80, { semanticKey: "considering" }),
  m("営業ステータス", "受注", 90, { semanticKey: "won" }),
  m("営業ステータス", "導入・実施中", 100, { semanticKey: "implementing" }),
  m("営業ステータス", "継続フォロー", 110, { semanticKey: "follow_up" }),
  m("営業ステータス", "保留", 120, { semanticKey: "on_hold" }),
  m("営業ステータス", "失注", 130, { semanticKey: "lost" }),
  // 集客ルート
  ...[
    "紹介",
    "セミナー",
    "広告",
    "Web問い合わせ",
    "展示会",
    "アウトバウンド",
    "既存顧客",
    "パートナー",
    "自治体・団体経由",
    "その他",
  ].map((name, i) => m("集客ルート", name, (i + 1) * 10)),
  // 優先度
  m("優先度", "高", 10, { color: "red" }),
  m("優先度", "中", 20, { color: "yellow" }),
  m("優先度", "低", 30, { color: "gray" }),
  // 対応履歴分類
  m("対応履歴分類", "電話", 10, { semanticTags: ["call"] }),
  m("対応履歴分類", "メール", 20, { semanticTags: ["email"] }),
  m("対応履歴分類", "訪問", 30, { semanticTags: ["meeting", "visit"] }),
  m("対応履歴分類", "オンライン商談", 40, {
    semanticTags: ["meeting", "online"],
  }),
  m("対応履歴分類", "資料送付", 50, { semanticTags: ["document"] }),
  m("対応履歴分類", "見積発行", 60, { semanticTags: ["quote"] }),
  m("対応履歴分類", "DM", 70, { semanticTags: ["dm"] }),
  m("対応履歴分類", "その他", 80, { semanticTags: ["other"] }),
  // 案件ステージ
  m("案件ステージ", "初回接触", 10, { semanticKey: "first_contact" }),
  m("案件ステージ", "ヒアリング", 20, { semanticKey: "hearing" }),
  m("案件ステージ", "提案", 30, { semanticKey: "proposal" }),
  m("案件ステージ", "見積提示", 40, { semanticKey: "quote" }),
  m("案件ステージ", "クロージング", 50, { semanticKey: "closing" }),
  m("案件ステージ", "受注", 60, { semanticKey: "won" }),
  m("案件ステージ", "失注", 70, { semanticKey: "lost" }),
  // 案件ステータス
  m("案件ステータス", "進行中", 10, { semanticKey: "active" }),
  m("案件ステータス", "受注", 20, { semanticKey: "won" }),
  m("案件ステータス", "失注", 30, { semanticKey: "lost" }),
  m("案件ステータス", "保留", 40, { semanticKey: "on_hold" }),
  m("案件ステータス", "完了", 50, { semanticKey: "completed" }),
  // 取引区分
  m("取引区分", "購入", 10),
  m("取引区分", "受注", 20),
  m("取引区分", "発注", 30),
  // 支払状況
  m("支払状況", "未請求", 10, { semanticKey: "unbilled" }),
  m("支払状況", "請求済", 20, { semanticKey: "billed" }),
  m("支払状況", "入金済", 30, { semanticKey: "paid" }),
  m("支払状況", "滞留", 40, { semanticKey: "overdue" }),
  // 契約状態
  m("契約状態", "有効", 10, { semanticKey: "active" }),
  m("契約状態", "満了", 20, { semanticKey: "expired" }),
  m("契約状態", "解約", 30, { semanticKey: "cancelled" }),
  m("契約状態", "取消", 40, { semanticKey: "void" }),
  // クレーム
  m("クレーム重要度", "高", 10, { color: "red" }),
  m("クレーム重要度", "中", 20, { color: "yellow" }),
  m("クレーム重要度", "低", 30, { color: "gray" }),
  m("クレーム対応状況", "未対応", 10, { semanticKey: "open" }),
  m("クレーム対応状況", "対応中", 20, { semanticKey: "in_progress" }),
  m("クレーム対応状況", "完了", 30, { semanticKey: "done" }),
  // 担当者区分
  m("担当者区分", "決裁者", 10),
  m("担当者区分", "担当者", 20),
  m("担当者区分", "窓口", 30),
  // アクション状態
  m("アクション状態", "未完了", 10, { semanticKey: "open" }),
  m("アクション状態", "完了", 20, { semanticKey: "done" }),
  m("アクション状態", "取消", 30, { semanticKey: "cancelled" }),
  // 関係性（product: Organization relationships / technical entity: customer）
  m("関係性", "顧客", 10, { semanticKey: "customer" }),
  m("関係性", "見込顧客", 20, { semanticKey: "prospect" }),
  m("関係性", "メディア", 30, { semanticKey: "media" }),
  m("関係性", "自治体", 40, { semanticKey: "municipality" }),
  m("関係性", "学校・研究機関", 50, { semanticKey: "education_research" }),
  m("関係性", "パートナー", 60, { semanticKey: "partner" }),
  m("関係性", "仕入先", 70, { semanticKey: "supplier" }),
  m("関係性", "その他", 80, { semanticKey: "other" }),
];

function m(
  masterType: string,
  name: string,
  sortOrder: number,
  extra?: Partial<InitialMasterSeed>,
): InitialMasterSeed {
  return {
    masterType,
    name,
    sortOrder,
    isActive: true,
    color: extra?.color ?? "default",
    semanticKey: extra?.semanticKey,
    semanticTags: extra?.semanticTags,
    applicableCategoryNames: extra?.applicableCategoryNames,
  };
}

export function masterExternalId(seed: InitialMasterSeed): string {
  return uuidV5(`master:${seed.masterType}:${seed.name}`);
}

/** 状態系semantic_keyは種別内一意 */
export function assertSemanticKeyUniqueness(
  seeds: InitialMasterSeed[] = INITIAL_MASTERS,
): void {
  const seen = new Map<string, string>();
  for (const seed of seeds) {
    if (!seed.semanticKey) continue;
    const key = `${seed.masterType}::${seed.semanticKey}`;
    if (seen.has(key)) {
      throw new Error(
        `semantic_key重複: ${seed.masterType} / ${seed.semanticKey}`,
      );
    }
    seen.set(key, seed.name);
  }
}

/** 分類系semantic_tagsは一意性を要求しない(重複タグ許容) */
export function semanticTagsAllowOverlap(
  seeds: InitialMasterSeed[] = INITIAL_MASTERS,
): boolean {
  const tagCounts = new Map<string, number>();
  for (const seed of seeds) {
    for (const tag of seed.semanticTags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  return [...tagCounts.values()].some((c) => c > 1);
}

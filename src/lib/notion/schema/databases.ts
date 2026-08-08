/**
 * Notion 9DBスキーマ定義(docs/notion-schema.md準拠)。
 * Phase A: 非relationプロパティ / Phase B: relation追加。
 */

export type NotionDbKey =
  | "customers"
  | "contacts"
  | "deals"
  | "activities"
  | "contracts"
  | "complaints"
  | "actions"
  | "masters"
  | "staff";

export type PropertyDef =
  | { name: string; type: "title" }
  | { name: string; type: "rich_text" }
  | { name: string; type: "number"; format?: "number" | "yen" | "percent" }
  | { name: string; type: "checkbox" }
  | { name: string; type: "url" }
  | { name: string; type: "email" }
  | { name: string; type: "phone_number" }
  | { name: string; type: "date" }
  | { name: string; type: "files" }
  | { name: string; type: "created_time" }
  | { name: string; type: "last_edited_time" }
  | {
      name: string;
      type: "select";
      options: Array<{ name: string; color?: string }>;
    }
  | {
      name: string;
      type: "relation";
      /** 参照先DBキー。自己参照は同一キー */
      target: NotionDbKey;
      dual?: boolean;
      single?: boolean;
    };

export type DatabaseDef = {
  key: NotionDbKey;
  title: string;
  envDataSourceKey: string;
  phaseAProperties: PropertyDef[];
  phaseBRelations: PropertyDef[];
};

export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

const COMMON: PropertyDef[] = [
  { name: "external_id", type: "rich_text" },
  { name: "作成日時", type: "created_time" },
  { name: "更新日時", type: "last_edited_time" },
];

export const MASTER_TYPES = [
  "事業区分",
  "タグ",
  "営業ステータス",
  "案件ステージ",
  "案件ステータス",
  "対応履歴分類",
  "集客ルート",
  "優先度",
  "契約区分",
  "取引区分",
  "支払状況",
  "契約状態",
  "クレーム重要度",
  "クレーム対応状況",
  "担当者区分",
  "アクション状態",
  "関係性",
] as const;

const NOTION_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];

/**
 * 自社担当者DBはnotion-schema.mdに独立節が無いため、
 * app_users同期に必要な最小プロパティとして定義(docs/supabase-schemaのnotion_staff_page_id用途)。
 */
export const DATABASES: DatabaseDef[] = [
  {
    key: "customers",
    title: "顧客アカウント",
    envDataSourceKey: "NOTION_DS_CUSTOMERS",
    phaseAProperties: [
      { name: "表示名", type: "title" },
      ...COMMON,
      { name: "法人名", type: "rich_text" },
      { name: "事業所名", type: "rich_text" },
      { name: "郵便番号", type: "rich_text" },
      {
        name: "都道府県",
        type: "select",
        options: PREFECTURES.map((name) => ({ name })),
      },
      { name: "市区町村", type: "rich_text" },
      { name: "住所以降", type: "rich_text" },
      { name: "電話番号", type: "phone_number" },
      { name: "メールアドレス", type: "email" },
      { name: "代表者名", type: "rich_text" },
      { name: "Webサイト", type: "url" },
      { name: "最新対応内容", type: "rich_text" },
      { name: "最終対応日", type: "date" },
      { name: "次回アクション", type: "rich_text" },
      { name: "次回予定日", type: "date" },
      { name: "見込み金額", type: "number", format: "yen" },
      { name: "アーカイブ", type: "checkbox" },
    ],
    phaseBRelations: [
      { name: "事業区分", type: "relation", target: "masters" },
      { name: "タグ", type: "relation", target: "masters" },
      { name: "関係性", type: "relation", target: "masters" },
      { name: "営業ステータス", type: "relation", target: "masters", single: true },
      { name: "集客ルート", type: "relation", target: "masters", single: true },
      { name: "優先度", type: "relation", target: "masters", single: true },
      { name: "自社担当者", type: "relation", target: "staff" },
      { name: "関連アカウント", type: "relation", target: "customers" },
    ],
  },
  {
    key: "contacts",
    title: "顧客担当者",
    envDataSourceKey: "NOTION_DS_CONTACTS",
    phaseAProperties: [
      { name: "氏名", type: "title" },
      ...COMMON,
      { name: "氏名よみ", type: "rich_text" },
      { name: "部署", type: "rich_text" },
      { name: "役職", type: "rich_text" },
      { name: "電話番号", type: "phone_number" },
      { name: "メールアドレス", type: "email" },
      { name: "備考", type: "rich_text" },
      { name: "有効", type: "checkbox" },
    ],
    phaseBRelations: [
      {
        name: "所属アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      { name: "区分", type: "relation", target: "masters", single: true },
    ],
  },
  {
    key: "deals",
    title: "案件",
    envDataSourceKey: "NOTION_DS_DEALS",
    phaseAProperties: [
      { name: "案件名", type: "title" },
      ...COMMON,
      { name: "商材", type: "rich_text" },
      { name: "見込み金額", type: "number", format: "yen" },
      { name: "契約金額", type: "number", format: "yen" },
      { name: "確度", type: "number", format: "percent" },
      { name: "受注予定日", type: "date" },
      { name: "契約日", type: "date" },
      { name: "契約期間", type: "date" },
      { name: "次回アクション", type: "rich_text" },
      { name: "次回予定日", type: "date" },
      { name: "失注理由", type: "rich_text" },
      { name: "備考", type: "rich_text" },
    ],
    phaseBRelations: [
      {
        name: "顧客アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      { name: "顧客担当者", type: "relation", target: "contacts" },
      { name: "事業区分", type: "relation", target: "masters", single: true },
      { name: "営業ステージ", type: "relation", target: "masters", single: true },
      { name: "自社担当者", type: "relation", target: "staff" },
      { name: "ステータス", type: "relation", target: "masters", single: true },
    ],
  },
  {
    key: "activities",
    title: "対応履歴",
    envDataSourceKey: "NOTION_DS_ACTIVITIES",
    phaseAProperties: [
      { name: "タイトル", type: "title" },
      ...COMMON,
      { name: "対応日時", type: "date" },
      { name: "要約", type: "rich_text" },
      { name: "次回アクション(入力記録)", type: "rich_text" },
      { name: "次回予定日(入力記録)", type: "date" },
      { name: "登録者ID", type: "rich_text" },
      { name: "登録者名", type: "rich_text" },
      { name: "最終編集者ID", type: "rich_text" },
      { name: "最終編集者名", type: "rich_text" },
      { name: "batch_id", type: "rich_text" },
    ],
    phaseBRelations: [
      {
        name: "顧客アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      { name: "関連案件", type: "relation", target: "deals", single: true },
      { name: "顧客担当者", type: "relation", target: "contacts" },
      { name: "対応分類", type: "relation", target: "masters" },
    ],
  },
  {
    key: "contracts",
    title: "契約",
    envDataSourceKey: "NOTION_DS_CONTRACTS",
    phaseAProperties: [
      { name: "契約名", type: "title" },
      ...COMMON,
      { name: "契約金額", type: "number", format: "yen" },
      { name: "契約日", type: "date" },
      { name: "契約開始日", type: "date" },
      { name: "契約終了日", type: "date" },
      { name: "自動更新", type: "checkbox" },
      { name: "請求条件", type: "rich_text" },
      { name: "契約書URL", type: "url" },
      { name: "契約書ファイル", type: "files" },
      { name: "備考", type: "rich_text" },
    ],
    phaseBRelations: [
      {
        name: "顧客アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      {
        name: "関連案件",
        type: "relation",
        target: "deals",
        dual: true,
        single: true,
      },
      { name: "契約区分", type: "relation", target: "masters", single: true },
      { name: "取引区分", type: "relation", target: "masters", single: true },
      { name: "支払状況", type: "relation", target: "masters", single: true },
      { name: "担当者", type: "relation", target: "staff" },
      { name: "状態", type: "relation", target: "masters", single: true },
    ],
  },
  {
    key: "complaints",
    title: "クレーム",
    envDataSourceKey: "NOTION_DS_COMPLAINTS",
    phaseAProperties: [
      { name: "タイトル", type: "title" },
      ...COMMON,
      { name: "発生日", type: "date" },
      { name: "概要", type: "rich_text" },
      { name: "対応期限", type: "date" },
      { name: "完了日", type: "date" },
      { name: "備考", type: "rich_text" },
    ],
    phaseBRelations: [
      {
        name: "顧客アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      { name: "関連案件", type: "relation", target: "deals", single: true },
      { name: "重要度", type: "relation", target: "masters", single: true },
      { name: "対応責任者", type: "relation", target: "staff", single: true },
      { name: "対応状況", type: "relation", target: "masters", single: true },
    ],
  },
  {
    key: "actions",
    title: "次回アクション",
    envDataSourceKey: "NOTION_DS_ACTIONS",
    phaseAProperties: [
      { name: "アクション内容", type: "title" },
      ...COMMON,
      { name: "期限", type: "date" },
      { name: "完了日時", type: "date" },
      { name: "作成者ID", type: "rich_text" },
      { name: "作成者名", type: "rich_text" },
    ],
    phaseBRelations: [
      {
        name: "顧客アカウント",
        type: "relation",
        target: "customers",
        dual: true,
        single: true,
      },
      { name: "案件", type: "relation", target: "deals", single: true },
      { name: "元対応履歴", type: "relation", target: "activities", single: true },
      { name: "自社担当者", type: "relation", target: "staff", single: true },
      { name: "状態", type: "relation", target: "masters", single: true },
      { name: "優先度", type: "relation", target: "masters", single: true },
    ],
  },
  {
    key: "masters",
    title: "営業マスタ",
    envDataSourceKey: "NOTION_DS_MASTERS",
    phaseAProperties: [
      { name: "名称", type: "title" },
      ...COMMON,
      {
        name: "マスタ種別",
        type: "select",
        options: MASTER_TYPES.map((name) => ({ name })),
      },
      { name: "semantic_key", type: "rich_text" },
      { name: "semantic_tags", type: "rich_text" },
      { name: "表示順", type: "number" },
      {
        name: "色",
        type: "select",
        options: NOTION_COLORS.map((name) => ({ name })),
      },
      { name: "有効", type: "checkbox" },
      { name: "備考", type: "rich_text" },
    ],
    phaseBRelations: [
      { name: "適用事業区分", type: "relation", target: "masters" },
    ],
  },
  {
    key: "staff",
    title: "自社担当者",
    envDataSourceKey: "NOTION_DS_STAFF",
    phaseAProperties: [
      { name: "氏名", type: "title" },
      ...COMMON,
      { name: "メールアドレス", type: "email" },
      { name: "ロール", type: "rich_text" },
      { name: "所属・役割", type: "rich_text" },
      { name: "有効", type: "checkbox" },
    ],
    phaseBRelations: [],
  },
];

export function getDatabase(key: NotionDbKey): DatabaseDef {
  const db = DATABASES.find((d) => d.key === key);
  if (!db) throw new Error(`unknown database key: ${key}`);
  return db;
}

export function assertAllHaveExternalId(): void {
  for (const db of DATABASES) {
    const has = db.phaseAProperties.some(
      (p) => p.name === "external_id" && p.type === "rich_text",
    );
    if (!has) throw new Error(`${db.title} にexternal_idがありません`);
  }
}

/** Phase Bは全database/data_source ID確定後に実行する順序 */
export const RELATION_PHASE_ORDER: NotionDbKey[] = [
  "masters",
  "staff",
  "customers",
  "contacts",
  "deals",
  "activities",
  "contracts",
  "complaints",
  "actions",
];

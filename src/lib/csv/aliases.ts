/**
 * CSV列名エイリアスと実WriteInput対応フィールドカタログ。
 * 導出値は unsupported。営業マスタ/自社担当者は通常CSV対象外。
 */
import type { ImportEntity } from "./entities";

export type FieldKind =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "master"
  | "relation"
  | "body"
  | "source_key"
  | "unsupported";

export type EntityField = {
  key: string;
  labelJa: string;
  required: boolean;
  kind: FieldKind;
  /** masters_cache.master_type */
  masterType?: string;
  notes?: string;
};

export const ENTITY_FIELDS: Record<ImportEntity, EntityField[]> = {
  customers: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key", notes: "再実行冪等用" },
    { key: "displayName", labelJa: "表示名", required: true, kind: "text" },
    { key: "legalName", labelJa: "法人名", required: false, kind: "text" },
    { key: "officeName", labelJa: "事業所名", required: false, kind: "text" },
    { key: "postalCode", labelJa: "郵便番号", required: false, kind: "text" },
    { key: "prefecture", labelJa: "都道府県", required: false, kind: "text" },
    { key: "city", labelJa: "市区町村", required: false, kind: "text" },
    { key: "addressLine", labelJa: "住所", required: false, kind: "text" },
    { key: "phone", labelJa: "電話番号", required: false, kind: "text" },
    { key: "email", labelJa: "メール", required: false, kind: "text" },
    { key: "representativeName", labelJa: "代表者名", required: false, kind: "text" },
    { key: "website", labelJa: "Webサイト", required: false, kind: "text" },
    { key: "businessCategoryNames", labelJa: "事業区分", required: false, kind: "master", masterType: "事業区分", notes: "複数は|;区切り" },
    { key: "tagNames", labelJa: "タグ", required: false, kind: "master", masterType: "タグ", notes: "複数は|;区切り" },
    { key: "salesStatusName", labelJa: "営業ステータス", required: false, kind: "master", masterType: "営業ステータス" },
    { key: "acquisitionRouteName", labelJa: "集客ルート", required: false, kind: "master", masterType: "集客ルート" },
    { key: "priorityName", labelJa: "優先度", required: false, kind: "master", masterType: "優先度" },
    { key: "isArchived", labelJa: "アーカイブ", required: false, kind: "boolean" },
    { key: "expectedAmount", labelJa: "見込み金額", required: false, kind: "unsupported", notes: "導出値のため書込不可" },
    { key: "latestActivitySummary", labelJa: "最新対応", required: false, kind: "unsupported" },
    { key: "lastActivityAt", labelJa: "最終対応日", required: false, kind: "unsupported" },
    { key: "nextAction", labelJa: "次回アクション", required: false, kind: "unsupported" },
    { key: "nextActionDate", labelJa: "次回予定日", required: false, kind: "unsupported" },
  ],
  contacts: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "name", labelJa: "氏名", required: true, kind: "text" },
    { key: "nameKana", labelJa: "よみ", required: false, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation", notes: "顧客の移行元IDまたはexternal_id" },
    { key: "department", labelJa: "部署", required: false, kind: "text" },
    { key: "title", labelJa: "役職", required: false, kind: "text" },
    { key: "phone", labelJa: "電話番号", required: false, kind: "text" },
    { key: "email", labelJa: "メール", required: false, kind: "text" },
    { key: "contactTypeName", labelJa: "担当者区分", required: false, kind: "master", masterType: "担当者区分" },
    { key: "note", labelJa: "備考", required: false, kind: "text" },
    { key: "isActive", labelJa: "有効", required: false, kind: "boolean" },
  ],
  deals: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "title", labelJa: "案件名", required: true, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation" },
    { key: "contactSourceKeys", labelJa: "担当者移行キー", required: false, kind: "relation", notes: "複数は|;区切り" },
    { key: "businessCategoryName", labelJa: "事業区分", required: false, kind: "master", masterType: "事業区分" },
    { key: "productName", labelJa: "商材", required: false, kind: "text" },
    { key: "stageName", labelJa: "営業ステージ", required: false, kind: "master", masterType: "案件ステージ" },
    { key: "statusName", labelJa: "ステータス", required: false, kind: "master", masterType: "案件ステータス" },
    { key: "expectedAmount", labelJa: "見込み金額", required: false, kind: "number" },
    { key: "contractAmount", labelJa: "契約金額", required: false, kind: "number" },
    { key: "probability", labelJa: "確度", required: false, kind: "number" },
    { key: "expectedCloseDate", labelJa: "受注予定日", required: false, kind: "date" },
    { key: "contractedAt", labelJa: "契約日", required: false, kind: "date" },
    { key: "periodStart", labelJa: "契約期間開始", required: false, kind: "date" },
    { key: "periodEnd", labelJa: "契約期間終了", required: false, kind: "date" },
    { key: "lostReason", labelJa: "失注理由", required: false, kind: "text" },
    { key: "note", labelJa: "備考", required: false, kind: "text" },
  ],
  activities: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "title", labelJa: "タイトル", required: true, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation" },
    { key: "dealSourceKey", labelJa: "案件移行キー", required: false, kind: "relation" },
    { key: "contactSourceKeys", labelJa: "担当者移行キー", required: false, kind: "relation" },
    { key: "activityAt", labelJa: "対応日時", required: true, kind: "date" },
    { key: "categoryNames", labelJa: "対応分類", required: false, kind: "master", masterType: "対応履歴分類", notes: "複数可" },
    { key: "summary", labelJa: "要約", required: false, kind: "text" },
    { key: "body", labelJa: "対応内容", required: false, kind: "body" },
    { key: "nextActionNote", labelJa: "次回アクションメモ", required: false, kind: "text" },
    { key: "nextActionDate", labelJa: "次回予定日メモ", required: false, kind: "date" },
  ],
  actions: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "title", labelJa: "内容", required: true, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation" },
    { key: "dealSourceKey", labelJa: "案件移行キー", required: false, kind: "relation" },
    { key: "dueDate", labelJa: "期限", required: true, kind: "date" },
    { key: "statusName", labelJa: "状態", required: true, kind: "master", masterType: "アクション状態" },
    { key: "priorityName", labelJa: "優先度", required: false, kind: "master", masterType: "優先度" },
    { key: "completedAt", labelJa: "完了日", required: false, kind: "date" },
  ],
  contracts: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "title", labelJa: "契約名", required: true, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation" },
    { key: "dealSourceKey", labelJa: "案件移行キー", required: false, kind: "relation" },
    { key: "contractTypeName", labelJa: "契約区分", required: false, kind: "master", masterType: "契約区分" },
    { key: "tradeTypeName", labelJa: "取引区分", required: false, kind: "master", masterType: "取引区分" },
    { key: "paymentStatusName", labelJa: "支払状況", required: false, kind: "master", masterType: "支払状況" },
    { key: "statusName", labelJa: "状態", required: false, kind: "master", masterType: "契約状態" },
    { key: "amount", labelJa: "契約金額", required: false, kind: "number" },
    { key: "contractedAt", labelJa: "契約日", required: false, kind: "date" },
    { key: "startDate", labelJa: "開始日", required: false, kind: "date" },
    { key: "endDate", labelJa: "終了日", required: false, kind: "date" },
    { key: "autoRenew", labelJa: "自動更新", required: false, kind: "boolean" },
    { key: "billingTerms", labelJa: "請求条件", required: false, kind: "text" },
    { key: "contractUrl", labelJa: "契約書URL", required: false, kind: "text" },
    { key: "note", labelJa: "備考", required: false, kind: "text" },
  ],
  complaints: [
    { key: "sourceRecordId", labelJa: "移行元ID", required: false, kind: "source_key" },
    { key: "title", labelJa: "タイトル", required: true, kind: "text" },
    { key: "customerSourceKey", labelJa: "顧客移行キー", required: true, kind: "relation" },
    { key: "dealSourceKey", labelJa: "案件移行キー", required: false, kind: "relation" },
    { key: "severityName", labelJa: "重要度", required: false, kind: "master", masterType: "クレーム重要度" },
    { key: "statusName", labelJa: "対応状況", required: false, kind: "master", masterType: "クレーム対応状況" },
    { key: "occurredOn", labelJa: "発生日", required: false, kind: "date" },
    { key: "summary", labelJa: "概要", required: false, kind: "text" },
    { key: "dueDate", labelJa: "対応期限", required: false, kind: "date" },
    { key: "completedOn", labelJa: "完了日", required: false, kind: "date" },
    { key: "note", labelJa: "備考", required: false, kind: "text" },
    { key: "content", labelJa: "内容", required: false, kind: "body" },
    { key: "cause", labelJa: "原因", required: false, kind: "body" },
    { key: "response", labelJa: "対応", required: false, kind: "body" },
    { key: "prevention", labelJa: "再発防止", required: false, kind: "body" },
  ],
};

/** ヘッダー別名 → field key 候補（曖昧なものは複数候補になり得る） */
export const HEADER_ALIASES: Record<string, string[]> = {
  会社名: ["displayName"],
  顧客名: ["displayName"],
  企業名: ["displayName"],
  表示名: ["displayName"],
  法人名: ["legalName"],
  会社正式名称: ["legalName"],
  事業所名: ["officeName"],
  施設名: ["officeName"],
  電話: ["phone"],
  電話番号: ["phone"],
  TEL: ["phone"],
  メール: ["email"],
  メールアドレス: ["email"],
  Email: ["email"],
  郵便番号: ["postalCode"],
  都道府県: ["prefecture"],
  市区町村: ["city"],
  住所: ["addressLine"],
  代表者: ["representativeName"],
  代表者名: ["representativeName"],
  Webサイト: ["website"],
  URL: ["website"],
  移行元ID: ["sourceRecordId"],
  source_id: ["sourceRecordId"],
  source_record_id: ["sourceRecordId"],
  氏名: ["name"],
  よみ: ["nameKana"],
  フリガナ: ["nameKana"],
  部署: ["department"],
  役職: ["title"],
  顧客移行キー: ["customerSourceKey"],
  顧客ID: ["customerSourceKey"],
  案件名: ["title"],
  案件移行キー: ["dealSourceKey"],
  見込み金額: ["expectedAmount"],
  対応日時: ["activityAt"],
  対応内容: ["body"],
  期限: ["dueDate"],
  契約名: ["title"],
  契約金額: ["amount"],
};

export function normalizeHeaderLabel(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().normalize("NFKC");
}

import type { NotionDbKey } from "@/lib/notion/schema/databases";

export type StandardViewDef = {
  key: string;
  name: string;
  databaseKey: NotionDbKey;
  type: "table" | "board";
  /** APIで表現するfilter/sortの要約(plan表示用) */
  filterSummary: string;
  sortSummary: string;
  /** APIで表現できないUI設定 */
  manualSetupNotes?: string[];
};

/**
 * docs/notion-schema.md §12 標準ビュー。
 * boardグループやquick_filter等、APIで確定できない項目はmanualSetupNotesへ。
 */
export const STANDARD_VIEWS: StandardViewDef[] = [
  {
    key: "customers_all",
    name: "全顧客",
    databaseKey: "customers",
    type: "table",
    filterSummary: "アーカイブ = false",
    sortSummary: "最終対応日 降順",
  },
  {
    key: "customers_by_status",
    name: "営業ステータス別",
    databaseKey: "customers",
    type: "board",
    filterSummary: "なし",
    sortSummary: "なし",
    manualSetupNotes: [
      "boardのグループプロパティ(営業ステータス)はNotion UIで確認・調整が必要な場合がある",
    ],
  },
  {
    key: "customers_by_category",
    name: "事業区分別",
    databaseKey: "customers",
    type: "table",
    filterSummary: "なし",
    sortSummary: "なし",
    manualSetupNotes: [
      "事業区分のquick_filterはNotion上で手動設定が必要",
    ],
  },
  {
    key: "customers_by_staff",
    name: "担当者別",
    databaseKey: "customers",
    type: "table",
    filterSummary: "なし",
    sortSummary: "なし",
    manualSetupNotes: [
      "自社担当者のquick_filterはNotion上で手動設定が必要(閲覧者本人の動的フィルタはAPI不可)",
    ],
  },
  {
    key: "actions_due",
    name: "本日・期限超過アクション",
    databaseKey: "actions",
    type: "table",
    filterSummary: "状態=未完了(open) かつ 期限が今日以前",
    sortSummary: "期限 昇順",
    manualSetupNotes: [
      "状態マスタページIDへのフィルタは初期マスタ投入後にproperty IDで解決する。相対日付(今日)のAPI表現が制限される場合はNotion上で手動調整が必要",
    ],
  },
  {
    key: "activities_latest",
    name: "最新対応履歴",
    databaseKey: "activities",
    type: "table",
    filterSummary: "なし",
    sortSummary: "対応日時 降順",
  },
  {
    key: "complaints_open",
    name: "未解決クレーム",
    databaseKey: "complaints",
    type: "table",
    filterSummary: "対応状況 ≠ 完了(done)",
    sortSummary: "対応期限 昇順",
  },
  {
    key: "contracts_active",
    name: "有効契約",
    databaseKey: "contracts",
    type: "table",
    filterSummary: "状態 = 有効(active)",
    sortSummary: "契約終了日 昇順",
  },
];

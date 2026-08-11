import type { HelpScreenGuide } from "@/lib/help/types";

/** 迷いやすい画面向けの短いガイド（常時表示しない） */
export const HELP_SCREEN_GUIDES: HelpScreenGuide[] = [
  {
    id: "inquiries",
    pathPrefixes: ["/inquiries"],
    title: "お問い合わせの使い方",
    summary:
      "Webフォームから来た相談の受信箱です。通常のGmail全部が入るわけではありません。",
    steps: [
      "未確認を開き、担当を決める",
      "既存組織候補を確認する",
      "紐付けまたは組織作成",
      "必要ならGmail返信下書き → 人が送信",
      "対応履歴・次回アクションを残す",
    ],
    tips: ["対応不要は理由を残す", "営業候補への自動変換はありません"],
    articleSlug: "handle-inquiry",
  },
  {
    id: "prospect-lists",
    pathPrefixes: ["/prospect-lists"],
    title: "営業リストの使い方",
    summary:
      "大量の営業候補をまとめて管理する場所です。正式な組織とは別です。",
    steps: [
      "リストを作成する",
      "CSVをインポートする",
      "担当を割り当てる",
      "架電キューで電話する",
    ],
    tips: [
      "一括割当の対象は表示中の行です",
      "管理メニューのCSV取込とは用途が違います",
    ],
    articleSlug: "import-prospect-csv",
  },
  {
    id: "prospects",
    pathPrefixes: ["/prospects"],
    title: "営業候補の使い方",
    summary: "会社そのものの候補データです。DNCや正式組織化の状態もここで確認できます。",
    steps: [
      "検索やフィルタで候補を探す",
      "詳細で架電・昇格・DNCを行う",
      "所属リストごとの進捗を確認する",
    ],
    tips: ["見込顧客（組織）とは別物です"],
    articleSlug: "prospect-vs-organization",
  },
  {
    id: "call-queue",
    pathPrefixes: ["/call-queue"],
    title: "架電キューの使い方",
    summary: "自分の担当営業先へ順番に電話する画面です。自動発信はしません。",
    steps: [
      "電話番号へ手で電話する",
      "結果を選ぶ",
      "必要なら次回連絡日時を入れる",
      "「保存して次へ」で次へ進む",
    ],
    tips: [
      "折返し希望は次回日時必須",
      "資料送付でもメールは自動送信されません",
      "Ctrl/Cmd+Enter で保存して次へ",
    ],
    articleSlug: "call-prospect",
  },
  {
    id: "organizations",
    pathPrefixes: ["/organizations", "/customers"],
    title: "組織の使い方",
    summary:
      "正式に付き合う会社・団体を管理します。関係性（顧客・見込顧客・メディアなど）を付けます。",
    steps: [
      "検索で既存がないか確認",
      "新規作成または既存を開く",
      "関係性・先方担当者を整える",
      "対応履歴・案件・契約へ進む",
    ],
    tips: ["大量CSVは営業リストへ", "関係性は複数可"],
    articleSlug: "create-organization",
  },
  {
    id: "activities",
    pathPrefixes: ["/activities"],
    title: "対応履歴の使い方",
    summary: "過去に何をしたかの記録です。これからやることは次回アクションへ。",
    steps: [
      "組織または案件から対応履歴を作成",
      "日時・内容を残す",
      "必要なら次回アクションも同時に作成（推奨）",
    ],
    tips: [
      "「当時入力した次回予定（履歴メモ）」だけでは、今日やることには追加されません",
    ],
    articleSlug: "activity-vs-action",
  },
  {
    id: "actions",
    pathPrefixes: ["/actions"],
    title: "次回アクションの使い方",
    summary: "これからやること（ToDo）です。期限を付けて管理します。",
    steps: [
      "内容・期限・自社担当者を入れる",
      "マイデスクの今日やることで確認",
      "終わったら完了にする",
    ],
    tips: ["営業候補の再架電予定は「次回連絡」側です"],
    articleSlug: "create-action",
  },
];

export function findScreenGuide(pathname: string): HelpScreenGuide | undefined {
  const path = pathname.split("?")[0] || pathname;
  return HELP_SCREEN_GUIDES.find((g) =>
    g.pathPrefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ),
  );
}

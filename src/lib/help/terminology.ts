import type { HelpTerm } from "@/lib/help/types";

export const HELP_TERMS: HelpTerm[] = [
  {
    id: "organization",
    term: "組織",
    short: "正式に会社と関係を持つ会社・団体",
    detail: [
      "顧客・見込顧客・メディア・自治体・学校・研究機関・パートナーなどを含みます。",
      "大量の未精査リストはここに直接入れません。",
    ],
    related: ["customer", "prospect-org", "sales-prospect"],
  },
  {
    id: "customer",
    term: "顧客",
    short: "組織の関係性のひとつ（購入・契約済みなど）",
    detail: [
      "ナビの「顧客」は組織一覧のフィルタです。",
      "新規組織で関係性未選択の場合、デフォルトで顧客が付くことがあります。",
    ],
    related: ["organization", "prospect-org"],
  },
  {
    id: "prospect-org",
    term: "見込顧客",
    short: "正式な組織の一種。具体的な関係を持ち始めた会社",
    detail: [
      "すでに商談や提案が始まっている段階で付ける関係性です。",
      "営業リスト上の「営業候補」とは別物です。",
    ],
    related: ["sales-prospect", "promote"],
  },
  {
    id: "sales-prospect",
    term: "営業候補",
    short: "まだ営業リスト上で電話してみる段階の候補",
    detail: [
      "CSVや展示会名簿など、精査前の大量候補がここに入ります。",
      "見込が立ったら正式組織へ昇格します。",
    ],
    related: ["prospect-org", "prospect-list", "promote"],
  },
  {
    id: "prospect-list",
    term: "営業リスト",
    short: "大量の営業候補をまとめて管理する単位",
    detail: [
      "担当割当・架電進捗・KPIをリスト単位で見られます。",
      "同じ会社が複数リストに入っても、会社本体はできるだけ1つに寄せます。",
    ],
    related: ["sales-prospect"],
  },
  {
    id: "external-contact",
    term: "先方担当者",
    short: "相手会社側の人物",
    detail: [
      "例: 株式会社さくらケアの山田様（施設長）。",
      "組織メニューの「担当者」は基本こちらです。",
    ],
    related: ["internal-staff", "role-b"],
  },
  {
    id: "internal-staff",
    term: "自社担当者",
    short: "うちの社員（案件・次回アクションなどの担当）",
    detail: [
      "例: 案件の自社担当者に石川を設定する。",
      "権限名の「担当者」とは別の概念です。",
    ],
    related: ["external-contact", "role-b"],
  },
  {
    id: "role-b",
    term: "権限の「担当者」",
    short: "ログイン権限の役割名のひとつ",
    detail: [
      "管理者 / 運用責任者 / 担当者 / 閲覧者、のうちの日常業務ロールです。",
      "先方担当者・自社担当者とは意味が違います。",
    ],
    related: ["external-contact", "internal-staff"],
  },
  {
    id: "deal",
    term: "案件",
    short: "具体的な営業商談",
    detail: [
      "興味ありだけでは作らず、導入条件などが具体化したタイミングがおすすめです。",
    ],
  },
  {
    id: "activity",
    term: "対応履歴",
    short: "過去に何をしたかの記録",
    detail: [
      "電話・メール・訪問・打合せなどの実績です。",
      "これからやることは次回アクションへ。",
    ],
    related: ["action"],
  },
  {
    id: "action",
    term: "次回アクション",
    short: "これからやること（ToDo）",
    detail: [
      "期限と自社担当者を持ち、完了操作があります。",
      "対応履歴内の「当時入力した次回予定（履歴メモ）」だけでは、今日やることには追加されません。",
    ],
    related: ["activity", "next-contact"],
  },
  {
    id: "next-contact",
    term: "次回連絡",
    short: "営業候補への再架電予定日時",
    detail: [
      "架電結果保存時に設定します。",
      "正式組織側の次回アクションとは別の仕組みです。",
    ],
    related: ["action", "sales-prospect"],
  },
  {
    id: "inquiry",
    term: "お問い合わせ",
    short: "Webフォームなどから来た相談の受信箱",
    detail: [
      "通常のGmail受信箱全体を取り込むものではありません。",
      "担当・状態・組織紐付け・返信下書きなどができます。",
    ],
  },
  {
    id: "dnc",
    term: "営業連絡不要（DNC）",
    short: "今後の営業架電対象から外す設定",
    detail: [
      "「興味なし」より強い措置です。",
      "同じ会社が別リストにあっても再架電対象になりません。",
    ],
    related: ["not-interested"],
  },
  {
    id: "not-interested",
    term: "興味なし",
    short: "今回の営業対象として対象外にする結果",
    detail: [
      "リスト上は対象外になりますが、営業連絡不要（DNC）にはしません。",
    ],
    related: ["dnc"],
  },
  {
    id: "promote",
    term: "正式組織化（昇格）",
    short: "営業候補を正式な組織として登録すること",
    detail: [
      "手動操作です。アポ獲得でも自動では組織になりません。",
      "既存組織への紐付け、または新規作成を選びます。",
    ],
    related: ["sales-prospect", "prospect-org"],
  },
  {
    id: "call-queue",
    term: "架電キュー / 今日の営業",
    short: "自分の担当営業先へ順番に電話する画面",
    detail: [
      "自動発信はしません。結果を保存して次へ進みます。",
    ],
  },
  {
    id: "mydesk",
    term: "マイデスク",
    short: "ログイン後にまず見るホーム画面",
    detail: [
      "今日やること、今日の営業、自分の案件、新着お問い合わせなどを確認します。",
    ],
  },
];

export function getHelpTerm(id: string): HelpTerm | undefined {
  return HELP_TERMS.find((t) => t.id === id);
}

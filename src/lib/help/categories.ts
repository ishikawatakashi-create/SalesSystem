import type { HelpCategory } from "@/lib/help/types";

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "getting-started",
    label: "はじめに",
    description: "はじめて使う方向けの基本",
  },
  {
    id: "organizations",
    label: "組織・担当者",
    description: "正式な関係先と先方担当者",
  },
  {
    id: "inquiries",
    label: "お問い合わせ",
    description: "Webフォームからの受信箱",
  },
  {
    id: "sales",
    label: "営業",
    description: "営業リスト・架電・昇格",
  },
  {
    id: "activities",
    label: "対応履歴・アクション",
    description: "過去の記録とこれからやること",
  },
  {
    id: "deals",
    label: "案件",
    description: "具体的な商談の管理",
  },
  {
    id: "contracts",
    label: "契約・クレーム",
    description: "契約情報と重大トラブル",
  },
  {
    id: "search",
    label: "検索",
    description: "会社名・人名からの横断検索",
  },
  {
    id: "permissions",
    label: "権限",
    description: "管理者・運用責任者・担当者・閲覧者",
  },
  {
    id: "admin",
    label: "管理者向け",
    description: "ユーザー・同期・取込設定",
    adminOnly: true,
  },
];

export function getHelpCategory(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id);
}

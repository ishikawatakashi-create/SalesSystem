import type { NavMenuSection } from "@/components/layout/nav-dropdown";

export type OrganizationNavOptions = {
  showProspects: boolean;
  showCallQueue: boolean;
};

/**
 * 「正式な組織」と「正式登録前の営業候補」を混同させないための
 * 組織ナビゲーション定義。権限判定そのものは呼び出し側で行う。
 */
export function buildOrganizationNavSections({
  showProspects,
  showCallQueue,
}: OrganizationNavOptions): NavMenuSection[] {
  const sections: NavMenuSection[] = [
    {
      id: "formal-organizations",
      label: "正式な組織",
      description: "案件・連絡先・活動履歴などを管理する正式登録先",
      icon: "organization",
      columns: 2,
      items: [
        { href: "/organizations", label: "すべての組織" },
        { href: "/organizations?relationship=customer", label: "顧客" },
        {
          href: "/organizations?relationship=prospect",
          label: "見込顧客",
        },
        { href: "/organizations?relationship=media", label: "メディア" },
        {
          href: "/organizations?relationship=municipality",
          label: "自治体",
        },
        {
          href: "/organizations?relationship=education_research",
          label: "学校・研究",
        },
        {
          href: "/organizations?relationship=partner",
          label: "パートナー",
        },
        {
          href: "/organizations?relationship=supplier",
          label: "仕入先",
        },
        { href: "/organizations?relationship=other", label: "その他" },
        { href: "/contacts", label: "先方担当者" },
      ],
    },
  ];

  if (showProspects) {
    sections.push({
      id: "sales-prospects",
      label: "営業候補",
      description: "まだ正式登録していない営業対象をリスト・架電で管理",
      icon: "prospect",
      items: [
        { href: "/prospect-lists", label: "営業リスト" },
        { href: "/prospects", label: "営業候補" },
        ...(showCallQueue
          ? [{ href: "/call-queue", label: "架電キュー" }]
          : []),
      ],
    });
  }

  return sections;
}

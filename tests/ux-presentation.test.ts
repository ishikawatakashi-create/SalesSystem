import { describe, expect, it } from "vitest";

import { buildOrganizationNavSections } from "@/components/layout/organization-nav";
import {
  PROSPECT_LIST_STATUS_LABELS,
  PROSPECT_SOURCE_TYPE_LABELS,
  canStartProspectPromotion,
  formalMatchConfidenceLabel,
  formalMatchReasonLabel,
  resolveProspectLifecycle,
  type ProspectLifecycle,
} from "@/lib/prospects/presentation";
import {
  PROSPECT_LIST_STATUSES,
  PROSPECT_PROMOTION_STATUSES,
  PROSPECT_SOURCE_TYPES,
  type ProspectPromotionStatus,
} from "@/lib/prospects/types";
import {
  complaintStatusLabel,
  contractStatusLabel,
  dealStatusLabel,
} from "@/lib/search/presentation";

describe("organization navigation presentation", () => {
  it("正式な組織と営業候補を2セクションに分ける", () => {
    const sections = buildOrganizationNavSections({
      showProspects: true,
      showCallQueue: true,
    });

    expect(sections.map(({ id, label, description, icon }) => ({
      id,
      label,
      description,
      icon,
    }))).toEqual([
      {
        id: "formal-organizations",
        label: "正式な組織",
        description: "案件・連絡先・活動履歴などを管理する正式登録先",
        icon: "organization",
      },
      {
        id: "sales-prospects",
        label: "営業候補",
        description: "まだ正式登録していない営業対象をリスト・架電で管理",
        icon: "prospect",
      },
    ]);
  });

  it("正式組織の8関係性と先方担当者への導線をすべて持つ", () => {
    const [formal] = buildOrganizationNavSections({
      showProspects: true,
      showCallQueue: true,
    });

    expect(formal?.items[0]).toEqual({
      href: "/organizations",
      label: "すべての組織",
    });
    expect(
      formal?.items.filter((item) => item.href.includes("?relationship=")),
    ).toEqual([
      { href: "/organizations?relationship=customer", label: "顧客" },
      { href: "/organizations?relationship=prospect", label: "見込顧客" },
      { href: "/organizations?relationship=media", label: "メディア" },
      { href: "/organizations?relationship=municipality", label: "自治体" },
      {
        href: "/organizations?relationship=education_research",
        label: "学校・研究",
      },
      { href: "/organizations?relationship=partner", label: "パートナー" },
      { href: "/organizations?relationship=supplier", label: "仕入先" },
      { href: "/organizations?relationship=other", label: "その他" },
    ]);
    expect(formal?.items.at(-1)).toEqual({
      href: "/contacts",
      label: "先方担当者",
    });
  });

  it("営業候補と架電キューを権限に応じて表示する", () => {
    const prospectsWithoutCalls = buildOrganizationNavSections({
      showProspects: true,
      showCallQueue: false,
    });
    expect(prospectsWithoutCalls[1]?.items).toEqual([
      { href: "/prospect-lists", label: "営業リスト" },
      { href: "/prospects", label: "営業候補" },
    ]);

    const fullAccess = buildOrganizationNavSections({
      showProspects: true,
      showCallQueue: true,
    });
    expect(fullAccess[1]?.items.at(-1)).toEqual({
      href: "/call-queue",
      label: "架電キュー",
    });

    for (const showCallQueue of [false, true]) {
      const formalOnly = buildOrganizationNavSections({
        showProspects: false,
        showCallQueue,
      });
      expect(formalOnly).toHaveLength(1);
      expect(formalOnly.flatMap((section) => section.items)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ href: "/prospect-lists" }),
          expect.objectContaining({ href: "/prospects" }),
          expect.objectContaining({ href: "/call-queue" }),
        ]),
      );
    }
  });
});

describe("prospect lifecycle presentation", () => {
  const expectedLifecycle = {
    none: { kind: "pre-registration", label: "正式登録前" },
    pending: { kind: "processing", label: "正式組織への登録処理中" },
    organization_created: {
      kind: "processing",
      label: "正式組織への登録処理中",
    },
    contacts_done: { kind: "processing", label: "正式組織への登録処理中" },
    activity_done: { kind: "processing", label: "正式組織への登録処理中" },
    action_done: { kind: "processing", label: "正式組織への登録処理中" },
    completed: { kind: "completed", label: "正式組織化済み" },
    failed: { kind: "failed", label: "正式組織への登録に失敗" },
  } satisfies Record<ProspectPromotionStatus, ProspectLifecycle>;

  it("全promotion statusを利用者向けライフサイクルに変換する", () => {
    for (const status of PROSPECT_PROMOTION_STATUSES) {
      expect(
        resolveProspectLifecycle(
          status,
          status === "completed" ? "notion-page-id" : null,
        ),
      ).toEqual(expectedLifecycle[status]);
    }
  });

  it("completedで組織page idがなければ要確認と表示する", () => {
    expect(resolveProspectLifecycle("completed", null)).toEqual({
      kind: "completed-link-missing",
      label: "正式組織化済み・組織リンク要確認",
    });
    expect(resolveProspectLifecycle("completed", undefined)).toEqual({
      kind: "completed-link-missing",
      label: "正式組織化済み・組織リンク要確認",
    });
  });

  it("未処理と失敗時だけ昇格を再開できる", () => {
    const canStartByStatus = {
      none: true,
      pending: false,
      organization_created: false,
      contacts_done: false,
      activity_done: false,
      action_done: false,
      completed: false,
      failed: true,
    } satisfies Record<ProspectPromotionStatus, boolean>;

    for (const status of PROSPECT_PROMOTION_STATUSES) {
      expect(canStartProspectPromotion(status), status).toBe(
        canStartByStatus[status],
      );
    }
    expect(canStartProspectPromotion(null)).toBe(true);
    expect(canStartProspectPromotion(undefined)).toBe(true);
    expect(canStartProspectPromotion("unknown-internal-value")).toBe(false);
  });
});

describe("prospect microcopy presentation", () => {
  it("リスト状態と取込元の内部値をすべて日本語表示に変換する", () => {
    expect(Object.keys(PROSPECT_LIST_STATUS_LABELS)).toEqual([
      ...PROSPECT_LIST_STATUSES,
    ]);
    expect(Object.keys(PROSPECT_SOURCE_TYPE_LABELS)).toEqual([
      ...PROSPECT_SOURCE_TYPES,
    ]);

    for (const raw of PROSPECT_LIST_STATUSES) {
      const label = PROSPECT_LIST_STATUS_LABELS[raw];
      expect(label).not.toBe(raw);
      expect(label).toMatch(/[ぁ-んァ-ヶ一-鿿]/);
    }
    for (const raw of PROSPECT_SOURCE_TYPES) {
      const label = PROSPECT_SOURCE_TYPE_LABELS[raw];
      expect(label).not.toBe(raw);
      expect(label).toMatch(/[ぁ-んァ-ヶ一-鿿]/);
    }
  });

  it("一致確度と根拠を内部値ではなく日本語で表示する", () => {
    expect(formalMatchConfidenceLabel("high")).toBe("一致の確度：高");
    expect(formalMatchConfidenceLabel("medium")).toBe("一致の確度：要確認");
    expect(formalMatchConfidenceLabel(null)).toBe("一致の確度：要確認");

    expect(formalMatchReasonLabel("domain")).toBe("Webドメインが一致");
    expect(formalMatchReasonLabel("phone")).toBe("電話番号が一致");
    expect(formalMatchReasonLabel("contact_email")).toBe("連絡先メールが一致");
    expect(formalMatchReasonLabel("company_address")).toBe(
      "会社名と所在地が一致",
    );
    expect(formalMatchReasonLabel("company_name")).toBe("会社名が一致");
    expect(formalMatchReasonLabel("internal_unknown")).toBe("登録内容が類似");
    expect(formalMatchReasonLabel(null)).toBe("登録内容が類似");
  });
});

describe("search result status presentation", () => {
  it("案件・契約・クレームの全既知状態を日本語で表示する", () => {
    const cases = [
      [
        dealStatusLabel,
        {
          active: "進行中",
          on_hold: "保留",
          won: "受注",
          lost: "失注",
          completed: "完了",
        },
      ],
      [
        contractStatusLabel,
        {
          active: "契約中",
          expired: "期間満了",
          cancelled: "解約済み",
          void: "無効",
        },
      ],
      [
        complaintStatusLabel,
        {
          open: "未対応",
          in_progress: "対応中",
          done: "対応完了",
        },
      ],
    ] as const;

    for (const [labelStatus, expected] of cases) {
      for (const [raw, label] of Object.entries(expected)) {
        const result = labelStatus(raw);
        expect(result, raw).toBe(label);
        expect(result, raw).not.toBe(raw);
        expect(result, raw).toMatch(/[ぁ-んァ-ヶ一-鿿]/);
      }
    }
  });

  it("未知値や空値は内部コードを出さずnullにする", () => {
    for (const labelStatus of [
      dealStatusLabel,
      contractStatusLabel,
      complaintStatusLabel,
    ]) {
      expect(labelStatus("unknown_internal_status")).toBeNull();
      expect(labelStatus("")).toBeNull();
      expect(labelStatus(null)).toBeNull();
      expect(labelStatus(undefined)).toBeNull();
    }
  });
});

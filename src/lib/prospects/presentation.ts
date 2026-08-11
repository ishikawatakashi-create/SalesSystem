import type {
  ProspectListStatus,
  ProspectPromotionStatus,
  ProspectSourceType,
} from "@/lib/prospects/types";

export const PROSPECT_LIST_STATUS_LABELS = {
  draft: "準備中",
  active: "利用中",
  paused: "一時停止",
  archived: "アーカイブ済み",
} satisfies Record<ProspectListStatus, string>;

export const PROSPECT_SOURCE_TYPE_LABELS = {
  vendor: "購入・提供リスト",
  scraping: "Web収集",
  event: "展示会・イベント",
  manual: "手動登録",
  csv: "CSV取込",
  other: "その他",
} satisfies Record<ProspectSourceType, string>;

export type ProspectLifecycleKind =
  | "pre-registration"
  | "processing"
  | "failed"
  | "completed"
  | "completed-link-missing";

export type ProspectLifecycle = {
  kind: ProspectLifecycleKind;
  label: string;
};

const PROCESSING_PROMOTION_STATUSES: ReadonlySet<ProspectPromotionStatus> =
  new Set([
    "pending",
    "organization_created",
    "contacts_done",
    "activity_done",
    "action_done",
  ]);

export function resolveProspectLifecycle(
  status: string | null | undefined,
  promotedPageId: string | null | undefined,
): ProspectLifecycle {
  if (status === "completed") {
    return promotedPageId
      ? { kind: "completed", label: "正式組織化済み" }
      : {
          kind: "completed-link-missing",
          label: "正式組織化済み・組織リンク要確認",
        };
  }
  if (status === "failed") {
    return { kind: "failed", label: "正式組織への登録に失敗" };
  }
  if (
    PROCESSING_PROMOTION_STATUSES.has(status as ProspectPromotionStatus)
  ) {
    return { kind: "processing", label: "正式組織への登録処理中" };
  }
  return { kind: "pre-registration", label: "正式登録前" };
}

export function canStartProspectPromotion(
  status: string | null | undefined,
): boolean {
  return !status || status === "none" || status === "failed";
}

export function formalMatchConfidenceLabel(
  confidence: string | null | undefined,
): string {
  return confidence === "high" ? "一致の確度：高" : "一致の確度：要確認";
}

export function formalMatchReasonLabel(
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "domain":
      return "Webドメインが一致";
    case "phone":
      return "電話番号が一致";
    case "contact_email":
      return "連絡先メールが一致";
    case "company_address":
      return "会社名と所在地が一致";
    case "company_name":
      return "会社名が一致";
    default:
      return "登録内容が類似";
  }
}

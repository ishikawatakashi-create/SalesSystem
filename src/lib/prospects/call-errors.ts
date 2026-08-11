const CALL_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  request_id_required:
    "保存の準備情報が失われました。画面を更新してもう一度お試しください",
  invalid_call_result: "架電結果を選び直してください",
  next_contact_required: "折返し希望は次回連絡日時が必須です",
  actor_not_found:
    "現在のユーザー情報を確認できません。再ログインしてもう一度お試しください",
  actor_inactive:
    "このアカウントは利用停止中のため、架電結果を保存できません",
  actor_not_provisioned:
    "アカウントの準備が完了していないため、架電結果を保存できません",
  actor_forbidden: "架電結果を保存する権限がありません",
  prospect_list_not_found:
    "この営業リストは見つかりません。架電キューを更新してください",
  prospect_list_archived:
    "この営業リストはアーカイブ済みのため、架電結果を保存できません",
  membership_not_found:
    "この架電対象は見つかりません。架電キューを更新してください",
  membership_archived:
    "この架電対象はアーカイブ済みです。架電キューを更新してください",
  membership_prospect_mismatch:
    "架電対象の情報が一致しません。画面を更新してやり直してください",
  membership_not_assigned_to_user:
    "この架電対象はあなたの担当ではありません。架電キューを更新してください",
  membership_stage_ineligible:
    "この架電対象は現在の進捗では架電できません。架電キューを更新してください",
  prospect_not_found:
    "この営業候補は見つかりません。架電キューを更新してください",
  prospect_archived:
    "この営業候補はアーカイブ済みです。架電キューを更新してください",
  prospect_do_not_contact:
    "この営業候補は営業連絡不要に設定されたため、架電結果を保存できません",
  prospect_promotion_ineligible:
    "この営業候補は正式組織化の処理中または完了済みのため、架電できません",
  call_claim_conflict:
    "この営業候補は別のユーザーによって更新されました。一覧を更新してください。",
  call_claim_required:
    "この営業候補は別のユーザーによって更新されました。一覧を更新してください。",
  contact_mismatch:
    "選択した先方担当者がこの営業候補に属していません。画面を更新してください",
  request_id_conflict:
    "保存リクエストが競合しました。画面を更新してもう一度お試しください",
  call_attempt_save_failed:
    "架電結果を保存できませんでした。画面を更新してもう一度お試しください",
  name_required: "先方担当者名を入力してください",
  contact_create_failed:
    "先方担当者を追加できませんでした。入力内容を確認してもう一度お試しください",
  promotion_in_progress:
    "正式組織化の処理が進行中です。完了後に画面を更新してください",
  existing_customer_required: "紐付け先の既存の正式な組織を選択してください",
  existing_customer_not_found:
    "選択した正式な組織が見つかりません。選択し直してください",
};

export function getCallErrorMessage(code: string): string {
  if (code.startsWith("organization_create_incomplete:")) {
    return "正式組織化を完了できませんでした。処理状況を確認してもう一度お試しください";
  }
  return CALL_ERROR_MESSAGES[code] ?? "操作に失敗しました。もう一度お試しください";
}

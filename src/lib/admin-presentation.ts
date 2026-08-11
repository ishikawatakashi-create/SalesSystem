export type AdminStatusTone =
  | "neutral"
  | "processing"
  | "warning"
  | "success"
  | "danger";

export type AdminStatusPresentation = {
  label: string;
  tone: AdminStatusTone;
};

const IMPORT_JOB_STATUS: Record<string, AdminStatusPresentation> = {
  pending: { label: "受付待ち", tone: "neutral" },
  uploaded: { label: "アップロード済み", tone: "neutral" },
  analyzing: { label: "ファイル解析中", tone: "processing" },
  parsing: { label: "ファイル解析中", tone: "processing" },
  mapping_required: { label: "列の対応付けが必要", tone: "warning" },
  validating: { label: "内容を確認中", tone: "processing" },
  validation_completed: { label: "内容確認済み", tone: "neutral" },
  ready: { label: "取込準備完了", tone: "neutral" },
  importing: { label: "取込中", tone: "processing" },
  partially_completed: { label: "一部完了", tone: "warning" },
  completed: { label: "取込完了", tone: "success" },
  cancelled: { label: "キャンセル済み", tone: "neutral" },
  failed: { label: "失敗", tone: "danger" },
};

const IMPORT_ROW_STATUS: Record<string, AdminStatusPresentation> = {
  pending: { label: "未処理", tone: "neutral" },
  valid_new: { label: "新規登録予定", tone: "neutral" },
  valid_update: { label: "更新予定", tone: "neutral" },
  duplicate: { label: "重複候補", tone: "warning" },
  invalid: { label: "取込不可", tone: "danger" },
  skipped: { label: "対象外", tone: "neutral" },
  importing: { label: "取込中", tone: "processing" },
  imported: { label: "取込済み", tone: "success" },
  import_failed: { label: "取込失敗", tone: "danger" },
};

const PREVIEW_SUMMARY_LABELS: Record<string, string> = {
  total: "総行数",
  valid: "取込可能",
  warning: "要確認",
  error: "エラー",
  valid_new: "新規登録予定",
  valid_update: "更新予定",
  duplicate: "重複候補",
  skipped: "対象外",
  relation_unresolved: "関連データ未特定",
  mapping_errors: "列の対応付けエラー",
};

const IMPORT_FAILURE_REASON_LABELS: Record<string, string> = {
  required_missing: "必須項目が入力されていません",
  unsupported_field: "CSV取込の対象外の項目です",
  master_not_found: "登録済みの選択肢が見つかりません",
  master_ambiguous: "同名の選択肢が複数あります",
  master_inactive: "利用停止中の選択肢です",
  relation_unresolved: "関連データを特定できません",
  relation_ambiguous: "関連データの候補が複数あります",
  invalid_boolean: "はい／いいえの値を確認してください",
  invalid_number: "数値の形式を確認してください",
  body_truncated: "長い本文の一部を省略しました",
  duplicate_candidate: "既存データと重複する可能性があります",
  duplicate_ambiguous: "重複候補を一つに特定できません",
  unknown_entity: "取込対象を判定できませんでした",
  import_failed: "システムへの登録処理に失敗しました",
};

const CSV_ACTION_ERROR_LABELS: Record<string, string> = {
  invalid_entity: "取込対象を選び直してください。",
  csv_only: "CSV形式のファイルを選択してください。",
  file_size: "CSVファイルが空でないこと、20MB以下であることを確認してください。",
  not_found: "取込データが見つかりません。表示を更新してください。",
  forbidden: "この取込を操作する権限がありません。",
  already_completed: "このCSVの取込は完了しています。",
  not_ready: "まだ取込を開始できません。先に内容確認を完了してください。",
};

const WEBHOOK_SETUP_STATUS_LABELS: Record<string, string> = {
  awaiting: "設定待ち",
  received: "確認用情報を受信済み",
  verified: "検証済み",
};

const USER_REGISTRATION_STATUS_LABELS: Record<string, string> = {
  pending: "ログイン準備中",
  auth_created: "ユーザー登録を準備中",
  profile_created: "自社担当者情報を同期中",
  completed: "登録完了",
  failed: "登録処理に失敗",
};

export function importJobStatusPresentation(
  status: string | null | undefined,
): AdminStatusPresentation {
  return (
    (status ? IMPORT_JOB_STATUS[status] : undefined) ?? {
      label: "状態要確認",
      tone: "warning",
    }
  );
}

export function importRowStatusPresentation(
  status: string | null | undefined,
): AdminStatusPresentation {
  return (
    (status ? IMPORT_ROW_STATUS[status] : undefined) ?? {
      label: "状態要確認",
      tone: "warning",
    }
  );
}

export function adminStatusBadgeClass(tone: AdminStatusTone): string {
  switch (tone) {
    case "processing":
      return "rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800";
    case "warning":
      return "rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800";
    case "success":
      return "rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800";
    case "danger":
      return "rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700";
    default:
      return "rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700";
  }
}

export function importPreviewSummaryLabel(key: string): string {
  return PREVIEW_SUMMARY_LABELS[key] ?? "その他の集計";
}

export function csvMappingErrorMessage(
  code: string | null | undefined,
  fieldLabel?: string,
): string {
  switch (code) {
    case "required_missing":
      return fieldLabel
        ? `必須項目「${fieldLabel}」に対応するCSV列を選択してください。`
        : "必須項目に対応するCSV列を選択してください。";
    case "duplicate_target":
      return fieldLabel
        ? `「${fieldLabel}」に複数のCSV列が割り当てられています。1列だけ選択してください。`
        : "同じ項目に複数のCSV列が割り当てられています。1列だけ選択してください。";
    case "unsupported_field":
      return fieldLabel
        ? `「${fieldLabel}」はCSV取込の対象外です。`
        : "選択した項目はCSV取込の対象外です。";
    default:
      return "列の対応付けを保存できませんでした。選択内容を確認してください。";
  }
}

export function csvActionErrorMessage(
  code: string | null | undefined,
): string {
  return (
    (code ? CSV_ACTION_ERROR_LABELS[code] : undefined) ??
    "操作を完了できませんでした。表示を更新して、もう一度お試しください。"
  );
}

export function csvImportFailureReason(
  reason: string | null | undefined,
  fieldLabels: Record<string, string> = {},
): string {
  if (!reason?.trim()) {
    return "取込できなかった理由を確認できませんでした。技術情報を確認してください。";
  }

  const messages = reason
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(":");
      const field = separator >= 0 ? part.slice(0, separator) : null;
      const code = separator >= 0 ? part.slice(separator + 1) : part;
      const message =
        IMPORT_FAILURE_REASON_LABELS[code] ??
        "システムへの登録処理に失敗しました";
      const fieldLabel = field && field !== "-" ? fieldLabels[field] : null;
      return fieldLabel ? `${fieldLabel}: ${message}` : message;
    });

  return [...new Set(messages)].join(" / ");
}

export function webhookSetupStatusLabel(
  status: string | null | undefined,
): string {
  return (
    (status ? WEBHOOK_SETUP_STATUS_LABELS[status] : undefined) ?? "状態要確認"
  );
}

export function userRegistrationStatusLabel(
  status: string | null | undefined,
): string {
  return (
    (status ? USER_REGISTRATION_STATUS_LABELS[status] : undefined) ??
    "登録状態を確認してください"
  );
}

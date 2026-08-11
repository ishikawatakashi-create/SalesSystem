const DEAL_STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  on_hold: "保留",
  won: "受注",
  lost: "失注",
  completed: "完了",
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  active: "契約中",
  expired: "期間満了",
  cancelled: "解約済み",
  void: "無効",
};

const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  open: "未対応",
  in_progress: "対応中",
  done: "対応完了",
};

function labelStatus(
  labels: Record<string, string>,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return labels[value] ?? null;
}

export function dealStatusLabel(value: string | null | undefined): string | null {
  return labelStatus(DEAL_STATUS_LABELS, value);
}

export function contractStatusLabel(
  value: string | null | undefined,
): string | null {
  return labelStatus(CONTRACT_STATUS_LABELS, value);
}

export function complaintStatusLabel(
  value: string | null | undefined,
): string | null {
  return labelStatus(COMPLAINT_STATUS_LABELS, value);
}

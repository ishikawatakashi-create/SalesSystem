const SOURCE_LABELS: Record<string, string> = {
  strikingly_email: "Webフォームから受信",
};

const PARSE_WARNING_LABELS: Record<string, string> = {
  empty_body: "本文を取得できませんでした。受信メールを確認してください。",
  unknown_template:
    "通常と異なる形式で受信しました。内容に欠けがないか確認してください。",
  sparse_fields:
    "取得できた項目が少ないため、問い合わせ本文も確認してください。",
  source_body_incomplete:
    "受信内容の一部を取得できませんでした。元のメールを確認してください。",
};

export function inquirySourceLabel(source: string | null | undefined): string {
  if (!source) return "受信元不明";
  return SOURCE_LABELS[source] ?? "その他の受信経路";
}

export function inquiryParseWarningLabel(
  code: string | null | undefined,
): string {
  if (!code) return "受信内容を完全に解析できませんでした。内容を確認してください。";
  return (
    PARSE_WARNING_LABELS[code] ??
    "受信内容を完全に解析できませんでした。内容を確認してください。"
  );
}

export function formatAttachmentSize(value: unknown): string | null {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

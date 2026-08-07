/** 一覧・詳細の表示整形 */

export {
  formatDate,
  formatDateTime,
  formatYen,
} from "@/features/customers/format";

/** 任意テキスト。null/空は全角ダッシュ */
export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

/** 期間表示 */
export function formatPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = start?.trim() || "";
  const e = end?.trim() || "";
  if (!s && !e) return "—";
  if (s && e) return `${s} 〜 ${e}`;
  if (s) return `${s} 〜`;
  return `〜 ${e}`;
}

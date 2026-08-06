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

/** 確度(%) */
export function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value}%`;
}

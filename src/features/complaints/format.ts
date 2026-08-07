/** 一覧・詳細の表示整形 */

export {
  formatDate,
  formatDateTime,
} from "@/features/customers/format";

/** 任意テキスト。null/空は全角ダッシュ */
export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

/** 一覧・詳細の表示整形。顧客側の純関数を再利用 */

export {
  formatDate,
  formatDateTime,
} from "@/features/customers/format";

/** 電話番号など任意テキスト。null/空は全角ダッシュ */
export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

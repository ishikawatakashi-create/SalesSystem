/** 次回アクションの表示整形 */

export {
  formatDate,
  formatDateTime,
} from "@/features/customers/format";

export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "—";
}

export { overdueDaysTokyo } from "@/lib/normalize/date-tokyo";

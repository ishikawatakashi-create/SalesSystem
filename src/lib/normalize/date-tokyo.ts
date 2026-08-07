/**
 * Asia/Tokyo 基準の日付ヘルパー。
 * 完了日などの「今日」判定は表示タイムゾーンに揃える。
 */

const TOKYO = "Asia/Tokyo";

/** 指定時刻(省略時は現在)の Asia/Tokyo 日付を YYYY-MM-DD で返す */
export function todayDateTokyo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Asia/Tokyo 日付の取得に失敗しました");
  }
  return `${year}-${month}-${day}`;
}

/** 期限日が今日より前なら超過日数。今日以降・不正は null */
export function overdueDaysTokyo(
  dueDateYmd: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dueDateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) return null;
  const today = todayDateTokyo(now);
  if (dueDateYmd >= today) return null;
  const dueParts = dueDateYmd.split("-").map(Number);
  const todayParts = today.split("-").map(Number);
  const y1 = dueParts[0] ?? 0;
  const m1 = dueParts[1] ?? 1;
  const d1 = dueParts[2] ?? 1;
  const y2 = todayParts[0] ?? 0;
  const m2 = todayParts[1] ?? 1;
  const d2 = todayParts[2] ?? 1;
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

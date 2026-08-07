/**
 * マイデスク用の純粋ヘルパー(テスト対象)。
 * 業務ロジックで日本語ステータス名は使わない。
 */

/** Asia/Tokyo の今日を YYYY-MM-DD で返す */
export function jstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** YYYY-MM-DD に日数を加算(暦日・UTC日付演算) */
export function addDaysYmd(ymd: string, delta: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const utc = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 期限超過日数。due < today なら日数、それ以外は null。
 * today は JST の YYYY-MM-DD を渡すこと。
 */
export function calcOverdueDays(
  dueDate: string | null | undefined,
  today: string,
): number | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (dueDate >= today) return null;
  const dueParts = dueDate.split("-").map(Number);
  const todayParts = today.split("-").map(Number);
  const a = Date.UTC(
    dueParts[0] ?? 0,
    (dueParts[1] ?? 1) - 1,
    dueParts[2] ?? 1,
  );
  const b = Date.UTC(
    todayParts[0] ?? 0,
    (todayParts[1] ?? 1) - 1,
    todayParts[2] ?? 1,
  );
  return Math.round((b - a) / 86_400_000);
}

/** null → 未入力、0 → ¥0 */
export function formatYen(amount: number | null): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "未入力";
  }
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export type PipelineAmountRow = {
  expected_amount: number | null;
};

/** null は合計から除外しつつ nullCount を数える。0 は 0 として加算 */
export function sumPipelineAmount(rows: PipelineAmountRow[]): {
  sum: number;
  nullCount: number;
} {
  let sum = 0;
  let nullCount = 0;
  for (const row of rows) {
    if (row.expected_amount === null || row.expected_amount === undefined) {
      nullCount += 1;
      continue;
    }
    sum += Number(row.expected_amount);
  }
  return { sum, nullCount };
}

export type PrioritizableAction = {
  assigneeUserId: string | null;
  dueDate: string | null;
};

/**
 * 自分のアクション優先ソート:
 * 1) assignee_user_id 一致を先
 * 2) due_date 昇順(null は末尾)
 */
export function prioritizeMyActions<T extends PrioritizableAction>(
  rows: T[],
  userId: string,
): T[] {
  return [...rows].sort((a, b) => {
    const aMatch = a.assigneeUserId === userId ? 0 : 1;
    const bMatch = b.assigneeUserId === userId ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    const ad = a.dueDate ?? "9999-99-99";
    const bd = b.dueDate ?? "9999-99-99";
    return ad.localeCompare(bd);
  });
}

export type BucketableAction = {
  dueDate: string | null;
};

export function bucketActionsByDueDate<T extends BucketableAction>(
  rows: T[],
  today: string,
  upcomingLimit = 10,
): { overdue: T[]; todayItems: T[]; upcoming: T[] } {
  const overdue: T[] = [];
  const todayItems: T[] = [];
  const upcoming: T[] = [];
  for (const row of rows) {
    const due = row.dueDate;
    if (!due) continue;
    if (due < today) overdue.push(row);
    else if (due === today) todayItems.push(row);
    else upcoming.push(row);
  }
  overdue.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  todayItems.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  upcoming.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return {
    overdue,
    todayItems,
    upcoming: upcoming.slice(0, upcomingLimit),
  };
}

export function aggregateCountsByKey(
  keys: Array<string | null | undefined>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** staff_user_ids の先頭要素で集計(無い行はスキップ) */
export function aggregateTopStaff(
  staffUserIdLists: string[][],
  limit = 10,
): Array<{ userId: string; count: number }> {
  const map = new Map<string, number>();
  for (const ids of staffUserIdLists) {
    const first = ids[0];
    if (!first) continue;
    map.set(first, (map.get(first) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

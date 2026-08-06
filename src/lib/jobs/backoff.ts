/**
 * 失敗後の再試行バックオフ(秒)。
 * attemptsはclaim時に加算済みの値を渡す。
 */
export function computeBackoffSeconds(attempts: number): number {
  const base = 30;
  const capped = Math.min(Math.max(attempts, 1), 8);
  return base * 2 ** (capped - 1);
}

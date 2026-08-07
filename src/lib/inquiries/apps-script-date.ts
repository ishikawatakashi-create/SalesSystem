/**
 * Apps Script `toIso8601_` と同趣旨。
 * Gmail Java Date 相当（getTime のみ）からも ISO8601 を作る。
 */
export function toIso8601FromDateLike(dateValue: {
  getTime: () => number;
}): string {
  const ms = dateValue.getTime();
  if (!Number.isFinite(ms)) {
    throw new Error("invalid_received_at");
  }
  return new Date(ms).toISOString();
}

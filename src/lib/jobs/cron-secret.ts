/**
 * ジョブワーカー起動認証。server-onlyに依存しない純関数。
 */
export function verifyCronSecret(
  headerValue: string | null,
  expected: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!expected || !headerValue) return false;
  const normalized = headerValue.startsWith("Bearer ")
    ? headerValue.slice("Bearer ".length)
    : headerValue;
  if (normalized.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ normalized.charCodeAt(i);
  }
  return mismatch === 0;
}

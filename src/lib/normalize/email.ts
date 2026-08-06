import { emptyToNull, toHalfWidthAscii } from "@/lib/normalize/text";

/**
 * メール正規化。auth側の normalizeEmail と同等(trim+lower)。
 * 空は null。
 */
export function normalizeEmailOrNull(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  return toHalfWidthAscii(raw).trim().toLowerCase();
}

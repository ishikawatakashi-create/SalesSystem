import { emptyToNull, toHalfWidthAscii } from "@/lib/normalize/text";

/**
 * 電話番号の検索用正規化: 数字のみ。
 * 表示用原文は呼び出し側で保持する。
 */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const digits = toHalfWidthAscii(raw).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

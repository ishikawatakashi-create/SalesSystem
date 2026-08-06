import { emptyToNull, toHalfWidthAscii } from "@/lib/normalize/text";

/**
 * 郵便番号の検索・照合用正規化: 数字のみ(7桁想定だが桁数検証はここではしない)。
 * 表示用はハイフン有無を原文として保持する。
 */
export function normalizePostalCode(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const digits = toHalfWidthAscii(raw).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** 表示用: 半角化しトリム。7桁なら XXX-XXXX 形式へ整形可 */
export function formatPostalCodeDisplay(
  value: string | null | undefined,
): string | null {
  const digits = normalizePostalCode(value);
  if (!digits) return null;
  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return digits;
}

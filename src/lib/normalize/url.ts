import { emptyToNull, toHalfWidthAscii } from "@/lib/normalize/text";

/**
 * URL正規化。空はnull。スキーム無しは https:// を付与して検証用に揃えるが、
 * Notion保存用の表示値は呼び出し側で別管理する。
 */
export function normalizeUrl(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const half = toHalfWidthAscii(raw).trim();
  if (!half) return null;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(half)
      ? half
      : `https://${half}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Notion保存用: 空はnull、それ以外は半角化トリム(不正でも原文寄せ) */
export function sanitizeUrlForStorage(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  return toHalfWidthAscii(raw).trim() || null;
}

import { toHalfWidthAscii } from "@/lib/normalize/text";

/** カタカナ → ひらがな */
export function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

/** ひらがな → カタカナ */
export function hiraganaToKatakana(value: string): string {
  return value.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

/**
 * かな検索用: NFKC → カタカナをひらがなへ統一 → 小文字化相当は英字のみ。
 */
export function normalizeKanaForSearch(value: string | null | undefined): string {
  if (!value) return "";
  const half = toHalfWidthAscii(value).toLowerCase();
  return katakanaToHiragana(half).replace(/\s+/g, "");
}

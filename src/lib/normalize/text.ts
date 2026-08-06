/**
 * テキスト正規化の共通ヘルパー。
 * 表示用原文は保持し、検索・照合用に別途正規化値を生成する。
 */

/** 空文字・空白のみを null にする(表示用の空欄扱い) */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** 前後空白除去。空なら null */
export function trimOrNull(value: string | null | undefined): string | null {
  return emptyToNull(value);
}

/**
 * 全角英数・全角スペース・全角ハイフン等を半角へ。
 * NFKCで大半を吸収しつつ、追加で空白類を半角スペースへ寄せる。
 */
export function toHalfWidthAscii(value: string): string {
  return value.normalize("NFKC").replace(/\u3000/g, " ");
}

/** 連続空白を1つにし、前後を除去 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 検索用: 空白をすべて除去 */
export function removeAllWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

/** 英字を小文字化(NFKC後) */
export function toSearchLower(value: string): string {
  return toHalfWidthAscii(value).toLowerCase();
}

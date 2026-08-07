/**
 * クイック対応入力用のタイトル生成(純粋関数)。
 * Notion title 制限を超えないよう truncate。
 */

const DEFAULT_MAX = 50;

/** 本文の最初の非空行を正規化し、maxLen 文字に truncate */
export function titleFromActivityBody(
  body: string,
  maxLen: number = DEFAULT_MAX,
): string {
  const firstLine =
    body
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.length > 0) ?? "";
  if (!firstLine) return "対応メモ";
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** Enter で submit すべきか(IME変換中は false) */
export function shouldSubmitOnEnter(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.isComposing) return false;
  if (event.nativeEvent?.isComposing) return false;
  // 一部ブラウザは変換確定 Enter で keyCode 229
  if (event.nativeEvent?.keyCode === 229) return false;
  return true;
}

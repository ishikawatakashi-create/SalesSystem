/**
 * ilike / PostgREST .or() 向けの検索語サニタイズ。
 * % _ はワイルドカードとして効かないよう除去し、フィルタ構文を壊す文字も除去する。
 */

/** ilike ワイルドカードと PostgREST or 構文を壊す文字を除去 */
export function sanitizeIlikeTerm(raw: string): string {
  return raw
    .replace(/[%_\\]/g, "")
    .replace(/[,.()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** サニタイズ後に前後ワイルドカードを付与。空なら null */
export function toIlikePattern(raw: string): string | null {
  const term = sanitizeIlikeTerm(raw);
  if (!term) return null;
  return `%${term}%`;
}

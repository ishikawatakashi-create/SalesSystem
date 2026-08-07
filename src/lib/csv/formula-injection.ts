/**
 * CSV エクスポート時の数式インジェクション対策。
 * Excel/Googleスプレッドシート等で危険な数式を防ぐため、
 * =+@-\t\r で始まるセル値の先頭に ' を付与する。
 *
 * @see docs/csv-import-design.md §6
 */

const FORMULA_PREFIXES = ["=", "+", "@", "-", "\t", "\r"];

/**
 * CSVセルをエクスポート用にサニタイズする。
 * 数式インジェクションを防ぐため、危険な先頭文字の前にシングルクォートを付与。
 */
export function sanitizeCsvCellForExport(value: string): string {
  if (!value || value.length === 0) {
    return value;
  }

  const firstChar = value[0];
  if (firstChar && FORMULA_PREFIXES.includes(firstChar)) {
    return `'${value}`;
  }

  return value;
}

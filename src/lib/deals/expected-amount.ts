/**
 * 顧客.見込み金額の集計ルール(semantic_key基準)。
 * 日本語表示名での比較は禁止。
 */
export const CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS = [
  "active",
  "on_hold",
] as const;

export type CustomerExpectedAmountStatusSemantic =
  (typeof CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS)[number];

const SEMANTIC_SET = new Set<string>(CUSTOMER_EXPECTED_AMOUNT_STATUS_SEMANTICS);

export type DealExpectedAmountRow = {
  status_semantic: string | null;
  expected_amount: number | null;
};

/**
 * active|on_hold かつ expected_amount が非nullの案件を合算する。
 * - null金額は除外、0は0として加算
 * - 該当案件なし → 0(nullにしない)
 */
export function computeCustomerExpectedAmountFromDeals(
  rows: DealExpectedAmountRow[],
): number {
  let sum = 0;
  for (const row of rows) {
    if (!row.status_semantic || !SEMANTIC_SET.has(row.status_semantic)) {
      continue;
    }
    if (row.expected_amount === null || row.expected_amount === undefined) {
      continue;
    }
    sum += Number(row.expected_amount);
  }
  return sum;
}

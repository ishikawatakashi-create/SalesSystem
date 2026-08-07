/**
 * 顧客重複検出ロジック（純粋関数）。
 *
 * @see docs/csv-import-design.md §3
 */

import {
  normalizeCompanyNameForSearch,
  normalizePhone,
} from "@/lib/normalize";

export type DuplicateConfidence = "high" | "medium" | "low";

export interface DuplicateCandidate {
  /** 候補の顧客ID（notion_page_id または既存インデックスID） */
  customerId: string;
  /** 重複判定理由 */
  reason: string;
  /** 信頼度 */
  confidence: DuplicateConfidence;
  /** マッチしたフィールド */
  matchedFields: string[];
}

export interface CustomerForDuplicateCheck {
  customerId: string;
  displayName?: string | null;
  legalName?: string | null;
  officeName?: string | null;
  prefecture?: string | null;
  phone?: string | null;
}

/**
 * 顧客の重複候補を検出する（優先順位順）。
 *
 * @param input インポート対象の顧客データ
 * @param existingCustomers 既存顧客リスト
 * @returns 重複候補の配列（優先順位の高い順）
 */
export function detectDuplicateCustomers(
  input: CustomerForDuplicateCheck,
  existingCustomers: CustomerForDuplicateCheck[],
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  const inputPhoneNorm = normalizePhone(input.phone);
  const inputLegalNameNorm = normalizeCompanyNameForSearch(input.legalName);
  const inputOfficeNameNorm = normalizeCompanyNameForSearch(input.officeName);
  const inputPrefecture = input.prefecture?.trim().toLowerCase();

  for (const existing of existingCustomers) {
    // 優先度1: 電話番号の完全一致
    if (inputPhoneNorm && inputPhoneNorm.length > 0) {
      const existingPhoneNorm = normalizePhone(existing.phone);
      if (
        existingPhoneNorm &&
        existingPhoneNorm.length > 0 &&
        inputPhoneNorm === existingPhoneNorm
      ) {
        candidates.push({
          customerId: existing.customerId,
          reason: "電話番号が一致",
          confidence: "high",
          matchedFields: ["phone"],
        });
        continue;
      }
    }

    // 優先度2: 法人名 + 事業所名の一致
    if (
      inputLegalNameNorm &&
      inputLegalNameNorm.length > 0 &&
      inputOfficeNameNorm &&
      inputOfficeNameNorm.length > 0
    ) {
      const existingLegalNameNorm = normalizeCompanyNameForSearch(
        existing.legalName,
      );
      const existingOfficeNameNorm = normalizeCompanyNameForSearch(
        existing.officeName,
      );

      if (
        existingLegalNameNorm.length > 0 &&
        existingOfficeNameNorm.length > 0 &&
        inputLegalNameNorm === existingLegalNameNorm &&
        inputOfficeNameNorm === existingOfficeNameNorm
      ) {
        candidates.push({
          customerId: existing.customerId,
          reason: "法人名と事業所名が一致",
          confidence: "high",
          matchedFields: ["legalName", "officeName"],
        });
        continue;
      }
    }

    // 優先度3: 法人名 + 都道府県の一致
    if (
      inputLegalNameNorm &&
      inputLegalNameNorm.length > 0 &&
      inputPrefecture &&
      inputPrefecture.length > 0
    ) {
      const existingLegalNameNorm = normalizeCompanyNameForSearch(
        existing.legalName,
      );
      const existingPrefecture = existing.prefecture?.trim().toLowerCase();

      if (
        existingLegalNameNorm.length > 0 &&
        existingPrefecture &&
        existingPrefecture.length > 0 &&
        inputLegalNameNorm === existingLegalNameNorm &&
        inputPrefecture === existingPrefecture
      ) {
        candidates.push({
          customerId: existing.customerId,
          reason: "法人名と都道府県が一致",
          confidence: "medium",
          matchedFields: ["legalName", "prefecture"],
        });
        continue;
      }
    }

    // 優先度4: trigram 類似度（簡易版: 表示名のレーベンシュタイン距離）
    // 実装簡略化のため、ここでは表示名の正規化後の完全一致を「低信頼度」候補とする
    const inputDisplayNameNorm = normalizeCompanyNameForSearch(
      input.displayName,
    );
    const existingDisplayNameNorm = normalizeCompanyNameForSearch(
      existing.displayName,
    );

    if (
      inputDisplayNameNorm &&
      inputDisplayNameNorm.length > 0 &&
      existingDisplayNameNorm.length > 0
    ) {
      // 簡易的な類似判定: 正規化後の部分一致
      if (
        inputDisplayNameNorm === existingDisplayNameNorm ||
        (inputDisplayNameNorm.length >= 3 &&
          existingDisplayNameNorm.includes(inputDisplayNameNorm)) ||
        (existingDisplayNameNorm.length >= 3 &&
          inputDisplayNameNorm.includes(existingDisplayNameNorm))
      ) {
        candidates.push({
          customerId: existing.customerId,
          reason: "表示名が類似",
          confidence: "low",
          matchedFields: ["displayName"],
        });
      }
    }
  }

  return candidates;
}

/**
 * CSV ファイル内の行同士の重複を検出する。
 *
 * @param rows インポート対象の顧客データ配列
 * @returns 重複グループの配列（各グループは行インデックスの配列）
 */
export function detectIntraFileDuplicates(
  rows: CustomerForDuplicateCheck[],
): number[][] {
  const groups: number[][] = [];
  const processed = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (processed.has(i)) continue;

    const group: number[] = [i];
    const inputRow = rows[i]!;

    for (let j = i + 1; j < rows.length; j++) {
      if (processed.has(j)) continue;

      const candidates = detectDuplicateCustomers(inputRow, [rows[j]!]);
      if (
        candidates.length > 0 &&
        (candidates[0]!.confidence === "high" ||
          candidates[0]!.confidence === "medium")
      ) {
        group.push(j);
        processed.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
      group.forEach((idx) => processed.add(idx));
    } else {
      processed.add(i);
    }
  }

  return groups;
}

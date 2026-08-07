/**
 * インポート行のソースキーと external_id の生成。
 *
 * @see docs/csv-import-design.md §4, docs/sync-design.md §1
 */

import { createHash } from "node:crypto";
import { uuidV5 } from "@/lib/notion/ids";

export interface SourceKeyOptions {
  /** ソースシステム名（例: "kintone", "salesforce"） */
  sourceSystem?: string;
  /** ソース側のレコードID */
  sourceRecordId: string;
}

/**
 * ソースキーを構築する。
 * フォーマット: "csv:sourceSystem:sourceRecordId" または "csv::sourceRecordId"
 */
export function buildSourceKey(options: SourceKeyOptions): string {
  const { sourceSystem, sourceRecordId } = options;
  const system = sourceSystem ?? "";
  return `csv:${system}:${sourceRecordId}`;
}

/**
 * ソースキーを SHA256 ハッシュ化する（検索用）。
 */
export function hashSourceKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * インポート行の決定的な external_id を生成する。
 *
 * ソースレコードIDがある場合:
 *   UUIDv5(namespace=SALES_SYSTEM_NAMESPACE, name="csv:sourceSystem:sourceRecordId")
 *
 * ない場合（行番号ベース）:
 *   UUIDv5(namespace=SALES_SYSTEM_NAMESPACE, name="importJobId:row:rowNumber")
 *
 * @param importJobId インポートジョブID
 * @param rowNumber 行番号（1-indexed、ヘッダー = 1）
 * @param sourceKey オプショナルなソースキー（buildSourceKey で構築）
 */
export function deterministicExternalId(
  importJobId: string,
  rowNumber: number,
  sourceKey?: string,
): string {
  if (sourceKey) {
    // ソースキーがある場合は、それをベースにする
    return uuidV5(sourceKey);
  }

  // ない場合は行番号ベース（importJobIdを名前に含める）
  return uuidV5(`${importJobId}:row:${rowNumber}`);
}

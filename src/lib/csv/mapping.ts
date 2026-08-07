/**
 * CSV 列マッピングの推測とバリデーション。
 *
 * @see docs/csv-import-design.md §3
 */

import type { ImportEntity } from "./entities";
import {
  ENTITY_FIELDS,
  HEADER_ALIASES,
  normalizeHeaderLabel,
  type EntityField,
} from "./aliases";

export interface MappingSuggestion {
  /** CSV ヘッダー名 */
  header: string;
  /** 推測されたシステムフィールドキー（null = マッピング不明） */
  fieldKey: string | null;
  /** 推測の信頼度 (0-1) */
  confidence?: number;
}

export interface MappingValidationError {
  code: "required_missing" | "duplicate_target" | "unsupported_field";
  /** エラー対象のシステムフィールドキー */
  fieldKey?: string;
  /** エラー対象のCSVヘッダー名 */
  header?: string;
  message: string;
}

export interface MappingValidationResult {
  ok: boolean;
  errors: MappingValidationError[];
}

/**
 * CSV ヘッダーからシステムフィールドへのマッピングを推測する。
 *
 * @param headers CSV ヘッダー行
 * @param entity 対象エンティティ
 * @returns ヘッダー → フィールドキーのマップ（マッピング不明は null）
 */
export function suggestMapping(
  headers: string[],
  entity: ImportEntity,
): Record<string, string | null> {
  const fields = ENTITY_FIELDS[entity] ?? [];
  const result: Record<string, string | null> = {};

  for (const header of headers) {
    const normalized = normalizeHeaderLabel(header);

    // エイリアスから検索
    const candidates = HEADER_ALIASES[normalized] ?? [];
    let matched: string | null = null;

    // 候補が複数ある場合は、エンティティのフィールドに含まれるものを優先
    for (const candidate of candidates) {
      if (fields.some((f) => f.key === candidate)) {
        matched = candidate;
        break;
      }
    }

    // エイリアスにない場合は、フィールドキーやラベルとの完全一致を試みる
    if (!matched) {
      const field = fields.find(
        (f) =>
          normalizeHeaderLabel(f.key) === normalized ||
          normalizeHeaderLabel(f.labelJa) === normalized,
      );
      matched = field?.key ?? null;
    }

    result[header] = matched;
  }

  return result;
}

/**
 * マッピングのバリデーション。
 *
 * @param mapping ヘッダー → フィールドキーのマップ
 * @param entity 対象エンティティ
 */
export function validateMapping(
  mapping: Record<string, string | null>,
  entity: ImportEntity,
): MappingValidationResult {
  const fields = ENTITY_FIELDS[entity] ?? [];
  const errors: MappingValidationError[] = [];

  // マッピングされたフィールドを収集
  const mappedFields = new Set<string>();
  const fieldToHeaders: Record<string, string[]> = {};

  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (fieldKey) {
      mappedFields.add(fieldKey);
      if (!fieldToHeaders[fieldKey]) {
        fieldToHeaders[fieldKey] = [];
      }
      fieldToHeaders[fieldKey]!.push(header);
    }
  }

  // 必須フィールドのチェック
  for (const field of fields) {
    if (field.required && !mappedFields.has(field.key)) {
      errors.push({
        code: "required_missing",
        fieldKey: field.key,
        message: `必須フィールド「${field.labelJa}」がマッピングされていません`,
      });
    }
  }

  // 重複ターゲットのチェック
  for (const [fieldKey, headers] of Object.entries(fieldToHeaders)) {
    if (headers.length > 1) {
      const field = fields.find((f) => f.key === fieldKey);
      errors.push({
        code: "duplicate_target",
        fieldKey,
        message: `フィールド「${field?.labelJa ?? fieldKey}」に複数の列（${headers.join(", ")}）がマッピングされています`,
      });
    }
  }

  // unsupported フィールドのチェック
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (fieldKey) {
      const field = fields.find((f) => f.key === fieldKey);
      if (field?.kind === "unsupported") {
        errors.push({
          code: "unsupported_field",
          fieldKey,
          header,
          message: `フィールド「${field.labelJa}」は派生フィールドのため、インポートできません`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * エンティティのフィールド定義を取得する。
 */
export function getEntityFields(entity: ImportEntity): EntityField[] {
  return ENTITY_FIELDS[entity] ?? [];
}

/**
 * マスタデータの解決（名称からNotion page_idへ）。
 *
 * @see docs/csv-import-design.md §3
 */

export interface MasterRecord {
  notion_page_id: string;
  name: string;
  master_type: string;
  is_active: boolean;
  semantic_key?: string | null;
}

export interface ResolveMasterOptions {
  /** マスタデータ配列 */
  masters: MasterRecord[];
  /** マスタ種別 */
  masterType: string;
  /** 検索する表示名 */
  displayName: string;
  /** エイリアスマップ（オプション: displayName → semantic_key） */
  aliases?: Record<string, string>;
}

export type ResolveMasterResult =
  | { pageId: string }
  | { error: "not_found" | "ambiguous" | "inactive" };

/**
 * マスタレコードを表示名で解決する。
 *
 * - NFKC 正規化 + trim で完全一致を試みる
 * - is_active = true のレコードのみ対象
 * - 複数ヒットした場合は ambiguous エラー
 */
export function resolveMasterByDisplayName(
  options: ResolveMasterOptions,
): ResolveMasterResult {
  const { masters, masterType, displayName, aliases } = options;

  const searchName = normalizeForMasterSearch(displayName);
  if (!searchName) {
    return { error: "not_found" };
  }

  // エイリアスから semantic_key を取得（もしあれば）
  const semanticKey = aliases?.[displayName];

  // マスタ種別でフィルタ
  const typedMasters = masters.filter((m) => m.master_type === masterType);

  // アクティブなマスタから検索
  const activeCandidates = typedMasters.filter((m) => m.is_active);

  // semantic_key による完全一致を優先
  if (semanticKey) {
    const matched = activeCandidates.filter(
      (m) => m.semantic_key === semanticKey,
    );
    if (matched.length === 1) {
      return { pageId: matched[0]!.notion_page_id };
    }
    if (matched.length > 1) {
      return { error: "ambiguous" };
    }
  }

  // 表示名による完全一致
  const matched = activeCandidates.filter(
    (m) => normalizeForMasterSearch(m.name) === searchName,
  );

  if (matched.length === 0) {
    // アクティブでないマスタにマッチする場合は inactive エラー
    const inactiveMatch = typedMasters.filter(
      (m) => !m.is_active && normalizeForMasterSearch(m.name) === searchName,
    );
    if (inactiveMatch.length > 0) {
      return { error: "inactive" };
    }

    return { error: "not_found" };
  }

  if (matched.length === 1) {
    return { pageId: matched[0]!.notion_page_id };
  }

  return { error: "ambiguous" };
}

function normalizeForMasterSearch(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().normalize("NFKC").toLowerCase();
}

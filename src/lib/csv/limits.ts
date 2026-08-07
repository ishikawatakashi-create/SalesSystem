/** CSV インポートファイルの最大サイズ (20MB) */
export const CSV_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** CSV インポートの最大行数 (ヘッダーを除く) */
export const CSV_MAX_ROWS = 10_000;

/** CSV インポートの最大列数 */
export const CSV_MAX_COLUMNS = 80;

/** 1セルの最大文字数 */
export const CSV_MAX_CELL_CHARS = 8_000;

/** 本文フィールドの最大文字数 */
export const CSV_MAX_BODY_CHARS = 20_000;

/** プレビュー表示行数 */
export const CSV_PREVIEW_ROWS = 50;

/** インポート時のチャンクサイズ (Notion API レート制限に配慮) */
export const CSV_IMPORT_CHUNK_SIZE = 10;

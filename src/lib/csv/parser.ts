/**
 * RFC 4180 準拠の CSV パーサー。
 * ストリーミングフレンドリーな設計（呼び出し側がチャンク化）。
 *
 * @see docs/csv-import-design.md §2
 */

import { CSV_MAX_CELL_CHARS, CSV_MAX_COLUMNS, CSV_MAX_ROWS } from "./limits";

export interface ParsedCsv {
  /** ヘッダー行 */
  headers: string[];
  /** データ行（ヘッダーを除く） */
  rows: string[][];
  /** 各データ行の元ファイル内行番号（1-indexed、ヘッダー = 1） */
  rowNumbers: number[];
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    public code: string,
    public row?: number,
    public col?: number,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * CSV テキストをパースする。
 *
 * @throws {CsvParseError} パースエラー
 */
export function parseCsv(input: string): ParsedCsv {
  // BOM を除去（エンコーディング層で除去済みだが念のため）
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;
  let row = 1;
  let col = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // エスケープされた引用符
          currentCell += '"';
          i++; // 次の " をスキップ
        } else {
          // 引用符の終了
          inQuotes = false;
        }
      } else {
        currentCell += char;
        if (char === "\n") {
          row++;
          col = 1;
        } else {
          col++;
        }
      }
    } else {
      if (char === '"') {
        // 引用符の開始
        inQuotes = true;
      } else if (char === ",") {
        // フィールド区切り
        validateCell(currentCell, row, col);
        currentRow.push(currentCell);
        currentCell = "";
        col++;
      } else if (char === "\r" && nextChar === "\n") {
        // CRLF: 行終了
        validateCell(currentCell, row, col);
        currentRow.push(currentCell);
        validateRow(currentRow, row);
        lines.push(currentRow);
        currentRow = [];
        currentCell = "";
        i++; // \n をスキップ
        row++;
        col = 1;
      } else if (char === "\n") {
        // LF: 行終了
        validateCell(currentCell, row, col);
        currentRow.push(currentCell);
        validateRow(currentRow, row);
        lines.push(currentRow);
        currentRow = [];
        currentCell = "";
        row++;
        col = 1;
      } else {
        currentCell += char;
        col++;
      }
    }
  }

  // 最後の行を追加
  if (inQuotes) {
    throw new CsvParseError(
      "引用符が閉じられていません",
      "malformed_csv",
      row,
      col,
    );
  }
  validateCell(currentCell, row, col);
  currentRow.push(currentCell);
  validateRow(currentRow, row);
  lines.push(currentRow);

  // 空行を除去
  const nonEmptyLines = lines.filter(
    (line) => !(line.length === 1 && line[0] === ""),
  );

  if (nonEmptyLines.length === 0) {
    throw new CsvParseError("CSV が空です", "malformed_csv");
  }

  const headers = nonEmptyLines[0]!;
  validateHeaders(headers);

  const rows = nonEmptyLines.slice(1);

  // 最大行数チェック
  if (rows.length > CSV_MAX_ROWS) {
    throw new CsvParseError(
      `データ行数が上限（${CSV_MAX_ROWS}行）を超えています`,
      "too_many_rows",
    );
  }

  // 行番号を生成（1-indexed、ヘッダー = 1）
  const rowNumbers = rows.map((_, idx) => idx + 2);

  return {
    headers,
    rows,
    rowNumbers,
  };
}

function validateCell(cell: string, row: number, col: number): void {
  if (cell.length > CSV_MAX_CELL_CHARS) {
    throw new CsvParseError(
      `セルの文字数が上限（${CSV_MAX_CELL_CHARS}文字）を超えています`,
      "cell_too_long",
      row,
      col,
    );
  }
}

function validateRow(row: string[], rowNum: number): void {
  if (row.length > CSV_MAX_COLUMNS) {
    throw new CsvParseError(
      `列数が上限（${CSV_MAX_COLUMNS}列）を超えています`,
      "too_many_columns",
      rowNum,
    );
  }
}

function validateHeaders(headers: string[]): void {
  const seen = new Set<string>();
  const normalized = headers.map((h) => h.trim().toLowerCase());

  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i]!;

    if (h === "") {
      throw new CsvParseError(
        `空のヘッダーが含まれています（列 ${i + 1}）`,
        "empty_header",
        1,
        i + 1,
      );
    }

    if (seen.has(h)) {
      throw new CsvParseError(
        `重複するヘッダーが含まれています: "${headers[i]}"`,
        "duplicate_header",
        1,
        i + 1,
      );
    }

    seen.add(h);
  }
}

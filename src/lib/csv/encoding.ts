/**
 * CSV ファイルの文字エンコーディング検出とデコード。
 * UTF-8 (BOM あり/なし) / Shift_JIS (CP932) をサポート。
 *
 * @see docs/csv-import-design.md §2
 */

export type SupportedEncoding = "utf-8" | "cp932" | "auto";
export type DetectedEncoding = "utf-8" | "utf-8-bom" | "shift_jis";

export class CsvEncodingError extends Error {
  readonly code = "unsupported_encoding" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CsvEncodingError";
  }
}

export interface DecodedCsv {
  /** デコード済みテキスト */
  text: string;
  /** 検出されたエンコーディング */
  encoding: DetectedEncoding;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * CSV バッファをデコードする。
 *
 * @throws {Error} デコード失敗時、code 'unsupported_encoding'
 */
export function decodeCsvBuffer(
  buf: Buffer,
  encoding: SupportedEncoding = "auto",
): DecodedCsv {
  // BOM チェック
  const hasBom = buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM);

  if (encoding === "utf-8") {
    // 明示的に UTF-8 指定
    const bufWithoutBom = hasBom ? buf.subarray(3) : buf;
    const text = decodeUtf8Strict(bufWithoutBom);
    return {
      text,
      encoding: hasBom ? "utf-8-bom" : "utf-8",
    };
  }

  if (encoding === "cp932") {
    // Shift_JIS / CP932 デコード
    const text = decodeShiftJis(buf);
    return {
      text,
      encoding: "shift_jis",
    };
  }

  // auto: UTF-8 を優先的に試す
  if (hasBom) {
    // BOM があれば UTF-8 確定
    const bufWithoutBom = buf.subarray(3);
    const text = decodeUtf8Strict(bufWithoutBom);
    return {
      text,
      encoding: "utf-8-bom",
    };
  }

  // BOM なし: まず UTF-8 として厳密にデコード試行
  try {
    const text = decodeUtf8Strict(buf);
    return {
      text,
      encoding: "utf-8",
    };
  } catch {
    // UTF-8 失敗 → Shift_JIS を試行
    try {
      const text = decodeShiftJis(buf);
      return {
        text,
        encoding: "shift_jis",
      };
    } catch {
      // どちらも失敗
      throw new CsvEncodingError(
        "文字エンコーディングの自動検出に失敗しました。UTF-8 または Shift_JIS を明示的に選択してください。",
      );
    }
  }
}

function decodeUtf8Strict(buf: Buffer): string {
  // TextDecoder の fatal モードで厳密にデコード
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(buf);
  } catch (e) {
    throw new CsvEncodingError("UTF-8 デコードに失敗しました（不正なバイト列）", {
      cause: e,
    });
  }
}

function decodeShiftJis(buf: Buffer): string {
  // Node.js の TextDecoder は 'shift_jis' をサポート (Node 12+)
  try {
    const decoder = new TextDecoder("shift_jis", { fatal: true });
    return decoder.decode(buf);
  } catch (e) {
    throw new CsvEncodingError(
      "Shift_JIS デコードに失敗しました。この環境では UTF-8 のみサポートされています。",
      { cause: e },
    );
  }
}

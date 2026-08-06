import {
  collapseWhitespace,
  removeAllWhitespace,
  toHalfWidthAscii,
  toSearchLower,
} from "@/lib/normalize/text";

/** 異体字の検索用写像(docs/supabase-schema.md) */
const VARIANT_MAP: Record<string, string> = {
  髙: "高",
  﨑: "崎",
  濵: "浜",
  邊: "辺",
  邉: "辺",
  齋: "斎",
  斉: "斎",
  瀨: "瀬",
  𠮷: "吉",
};

const CORP_FORMS: Array<[RegExp, string]> = [
  [/株式会社/g, "(株)"],
  [/有限会社/g, "(有)"],
  [/合同会社/g, "(同)"],
  [/合名会社/g, "(名)"],
  [/合資会社/g, "(資)"],
  [/一般社団法人/g, "(一社)"],
  [/公益社団法人/g, "(公社)"],
  [/一般財団法人/g, "(一財)"],
  [/公益財団法人/g, "(公財)"],
  [/社会福祉法人/g, "(社福)"],
  [/医療法人社団/g, "(医)"],
  [/医療法人財団/g, "(医)"],
  [/医療法人/g, "(医)"],
  [/社会医療法人/g, "(医)"],
  [/特定非営利活動法人/g, "(NPO)"],
  [/ＮＰＯ法人/g, "(NPO)"],
  [/NPO法人/gi, "(NPO)"],
];

function applyVariants(value: string): string {
  let out = value;
  for (const [from, to] of Object.entries(VARIANT_MAP)) {
    out = out.split(from).join(to);
  }
  return out;
}

function unifyCorpForms(value: string): string {
  let out = value;
  for (const [re, rep] of CORP_FORMS) {
    out = out.replace(re, rep);
  }
  // 先頭・末尾の(株)等はそのまま残し、検索用に括弧も除去したバリアントは呼び出し側で連結可
  return out;
}

/**
 * 表示名・法人名などの検索用正規化文字列。
 * NFKC / 法人格統一 / 空白除去 / 小文字 / 異体字写像。
 */
export function normalizeCompanyNameForSearch(
  value: string | null | undefined,
): string {
  if (!value) return "";
  let out = toSearchLower(value);
  out = applyVariants(out);
  out = unifyCorpForms(out);
  out = removeAllWhitespace(out);
  return out;
}

/** 空白は潰すが文字は残す表示寄り正規化(input_hash用) */
export function normalizeCompanyNameForHash(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const half = collapseWhitespace(toHalfWidthAscii(value));
  if (!half) return null;
  return applyVariants(unifyCorpForms(half));
}

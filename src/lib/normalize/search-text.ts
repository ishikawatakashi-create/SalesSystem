import { normalizeCompanyNameForSearch } from "@/lib/normalize/company";
import { normalizeKanaForSearch } from "@/lib/normalize/kana";
import { normalizePhone } from "@/lib/normalize/phone";
import { normalizeEmailOrNull } from "@/lib/normalize/email";
import { removeAllWhitespace, toSearchLower } from "@/lib/normalize/text";

export type CustomerSearchSource = {
  displayName: string;
  legalName: string | null;
  officeName: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
  representativeName: string | null;
  /** 顧客担当者名など、依存再index時に渡す追加トークン */
  extraTokens?: string[];
};

/**
 * customer_index.search_text 生成。
 * 空白除去済みの正規化トークンをスペース区切りで連結。
 */
export function buildCustomerSearchText(source: CustomerSearchSource): string {
  const parts = [
    normalizeCompanyNameForSearch(source.displayName),
    normalizeCompanyNameForSearch(source.legalName),
    normalizeCompanyNameForSearch(source.officeName),
    source.prefecture ? removeAllWhitespace(toSearchLower(source.prefecture)) : "",
    source.city ? removeAllWhitespace(toSearchLower(source.city)) : "",
    source.addressLine
      ? removeAllWhitespace(toSearchLower(source.addressLine))
      : "",
    normalizePhone(source.phone) ?? "",
    normalizeEmailOrNull(source.email) ?? "",
    source.representativeName
      ? removeAllWhitespace(toSearchLower(source.representativeName))
      : "",
    ...(source.extraTokens ?? []).map((t) =>
      removeAllWhitespace(toSearchLower(t)),
    ),
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

/**
 * customer_index.search_text_kana 生成。
 * かな統一したトークンを連結(担当者よみ等は extraTokens で渡す)。
 */
export function buildCustomerSearchTextKana(
  source: CustomerSearchSource,
): string {
  const parts = [
    normalizeKanaForSearch(source.displayName),
    normalizeKanaForSearch(source.legalName),
    normalizeKanaForSearch(source.officeName),
    normalizeKanaForSearch(source.representativeName),
    ...(source.extraTokens ?? []).map((t) => normalizeKanaForSearch(t)),
  ].filter((p) => p.length > 0);
  return parts.join(" ");
}

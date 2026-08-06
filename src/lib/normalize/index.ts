export {
  emptyToNull,
  trimOrNull,
  toHalfWidthAscii,
  collapseWhitespace,
  removeAllWhitespace,
  toSearchLower,
} from "@/lib/normalize/text";
export { normalizePhone } from "@/lib/normalize/phone";
export {
  normalizePostalCode,
  formatPostalCodeDisplay,
} from "@/lib/normalize/postal";
export { normalizeEmailOrNull } from "@/lib/normalize/email";
export { normalizeUrl, sanitizeUrlForStorage } from "@/lib/normalize/url";
export {
  normalizeCompanyNameForSearch,
  normalizeCompanyNameForHash,
} from "@/lib/normalize/company";
export {
  katakanaToHiragana,
  hiraganaToKatakana,
  normalizeKanaForSearch,
} from "@/lib/normalize/kana";
export {
  buildCustomerSearchText,
  buildCustomerSearchTextKana,
  type CustomerSearchSource,
} from "@/lib/normalize/search-text";

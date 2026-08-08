import { emptyToNull, toHalfWidthAscii } from "@/lib/normalize/text";
import { normalizeEmailOrNull } from "@/lib/normalize/email";

/**
 * URL / ホスト文字列 / email から照合用ドメインを抽出。
 * lowercase、www. 除去、protocol/path 除去。不正は null。
 */
export function normalizeDomain(
  value: string | null | undefined,
): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const half = toHalfWidthAscii(raw).trim().toLowerCase();
  if (!half) return null;

  // email → domain
  if (half.includes("@") && !half.includes("://")) {
    const email = normalizeEmailOrNull(half);
    if (!email) return null;
    const at = email.lastIndexOf("@");
    const host = email.slice(at + 1);
    return host || null;
  }

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/.test(half)
      ? half
      : `https://${half}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    // bare hostname-ish
    const host = half
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      ?.split("?")[0]
      ?.split("#")[0]
      ?.replace(/^www\./, "");
    if (!host || host.includes(" ") || !host.includes(".")) return null;
    return host;
  }
}

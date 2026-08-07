import { createHmac, timingSafeEqual } from "node:crypto";

/** Apps Script → SalesSystem HMAC canonical string */
export function buildInquirySignaturePayload(
  timestamp: string,
  rawBody: string,
): string {
  return `${timestamp}.${rawBody}`;
}

export function signInquiryRequest(
  timestamp: string,
  rawBody: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(buildInquirySignaturePayload(timestamp, rawBody), "utf8")
    .digest("hex");
}

/** hex 署名の constant-time 比較 */
export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export const INQUIRY_HMAC_MAX_SKEW_MS = 5 * 60 * 1000;

export function isTimestampFresh(
  timestamp: string,
  nowMs = Date.now(),
  maxSkewMs = INQUIRY_HMAC_MAX_SKEW_MS,
): boolean {
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  // 秒でもミリ秒でも受け付ける
  const ms = t < 1e12 ? t * 1000 : t;
  return Math.abs(nowMs - ms) <= maxSkewMs;
}

export function verifyInquiryHmac(input: {
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  secret: string;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.timestamp?.trim()) {
    return { ok: false, reason: "missing_timestamp" };
  }
  if (!input.signature?.trim()) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!isTimestampFresh(input.timestamp, input.nowMs)) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = signInquiryRequest(
    input.timestamp.trim(),
    input.rawBody,
    input.secret,
  );
  const provided = input.signature.trim().toLowerCase();
  if (!safeEqualHex(expected, provided)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

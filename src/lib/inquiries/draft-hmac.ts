import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DRAFT_HMAC_MAX_SKEW_MS = 5 * 60 * 1000;

export function buildDraftEnvelopeSignature(
  timestamp: string,
  nonce: string,
  payloadB64: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${payloadB64}`, "utf8")
    .digest("hex");
}

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

export function isDraftTimestampFresh(
  timestamp: string,
  nowMs = Date.now(),
  maxSkewMs = DRAFT_HMAC_MAX_SKEW_MS,
): boolean {
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  const ms = t < 1e12 ? t * 1000 : t;
  return Math.abs(nowMs - ms) <= maxSkewMs;
}

export function encodePayloadB64(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function newDraftNonce(): string {
  return randomBytes(16).toString("hex");
}

export function buildSignedDraftEnvelope(input: {
  payload: unknown;
  secret: string;
  nowMs?: number;
  nonce?: string;
}): {
  timestamp: string;
  nonce: string;
  payload_b64: string;
  signature: string;
} {
  const timestamp = String(input.nowMs ?? Date.now());
  const nonce = input.nonce ?? newDraftNonce();
  const payload_b64 = encodePayloadB64(input.payload);
  const signature = buildDraftEnvelopeSignature(
    timestamp,
    nonce,
    payload_b64,
    input.secret,
  );
  return { timestamp, nonce, payload_b64, signature };
}

export function verifyDraftEnvelope(input: {
  timestamp: string | null;
  nonce: string | null;
  payload_b64: string | null;
  signature: string | null;
  secret: string;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.timestamp?.trim()) return { ok: false, reason: "missing_timestamp" };
  if (!input.nonce?.trim()) return { ok: false, reason: "missing_nonce" };
  if (!input.payload_b64?.trim()) return { ok: false, reason: "missing_payload" };
  if (!input.signature?.trim()) return { ok: false, reason: "missing_signature" };
  if (!isDraftTimestampFresh(input.timestamp, input.nowMs)) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = buildDraftEnvelopeSignature(
    input.timestamp.trim(),
    input.nonce.trim(),
    input.payload_b64.trim(),
    input.secret,
  );
  if (!safeEqualHex(expected, input.signature.trim().toLowerCase())) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

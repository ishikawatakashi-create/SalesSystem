import { describe, expect, it } from "vitest";

import {
  buildInquirySignaturePayload,
  isTimestampFresh,
  safeEqualHex,
  signInquiryRequest,
  verifyInquiryHmac,
} from "@/lib/inquiries/apps-script-hmac";

const SECRET = "test-secret-at-least-16";

describe("inquiry Apps Script HMAC", () => {
  it("canonical payload と署名が決定的", () => {
    const body = '{"gmail_message_id":"m1"}';
    const ts = "1700000000000";
    expect(buildInquirySignaturePayload(ts, body)).toBe(`${ts}.${body}`);
    const a = signInquiryRequest(ts, body, SECRET);
    const b = signInquiryRequest(ts, body, SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("valid HMAC を受け入れる", () => {
    const body = '{"type":"heartbeat"}';
    const ts = String(Date.now());
    const sig = signInquiryRequest(ts, body, SECRET);
    expect(
      verifyInquiryHmac({
        timestamp: ts,
        signature: sig,
        rawBody: body,
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it("invalid HMAC / tampered body を拒否", () => {
    const body = '{"gmail_message_id":"m1"}';
    const ts = String(Date.now());
    const sig = signInquiryRequest(ts, body, SECRET);
    expect(
      verifyInquiryHmac({
        timestamp: ts,
        signature: sig,
        rawBody: '{"gmail_message_id":"m2"}',
        secret: SECRET,
      }).ok,
    ).toBe(false);
    expect(
      verifyInquiryHmac({
        timestamp: ts,
        signature: "00".repeat(32),
        rawBody: body,
        secret: SECRET,
      }).ok,
    ).toBe(false);
  });

  it("stale timestamp を拒否", () => {
    const body = "{}";
    const stale = String(Date.now() - 10 * 60 * 1000);
    const sig = signInquiryRequest(stale, body, SECRET);
    const r = verifyInquiryHmac({
      timestamp: stale,
      signature: sig,
      rawBody: body,
      secret: SECRET,
    });
    expect(r).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("missing signature / timestamp", () => {
    const missingTs = verifyInquiryHmac({
      timestamp: null,
      signature: "aa",
      rawBody: "{}",
      secret: SECRET,
    });
    expect(missingTs.ok).toBe(false);
    if (!missingTs.ok) expect(missingTs.reason).toBe("missing_timestamp");

    const missingSig = verifyInquiryHmac({
      timestamp: String(Date.now()),
      signature: null,
      rawBody: "{}",
      secret: SECRET,
    });
    expect(missingSig.ok).toBe(false);
    if (!missingSig.ok) expect(missingSig.reason).toBe("missing_signature");
  });

  it("safeEqualHex は長さ不一致で false", () => {
    expect(safeEqualHex("aa", "aabb")).toBe(false);
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
  });

  it("timestamp 秒/ミリ秒の両方を許容", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isTimestampFresh(String(nowSec))).toBe(true);
    expect(isTimestampFresh(String(Date.now()))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  getCallResultSideEffects,
  isConnectedClassResult,
  isCallResult,
} from "@/lib/prospects/call-results";

describe("Phase13B call result semantics", () => {
  it("callback_requested requires next contact", () => {
    const e = getCallResultSideEffects("callback_requested");
    expect(e.requireNextContact).toBe(true);
    expect(e.membershipStage).toBe("working");
  });

  it("interested/appointment qualify without auto-promote", () => {
    expect(getCallResultSideEffects("interested").membershipStage).toBe(
      "qualified",
    );
    expect(getCallResultSideEffects("appointment").promoteCtaStrong).toBe(true);
    expect(getCallResultSideEffects("appointment").membershipStage).toBe(
      "qualified",
    );
  });

  it("not_interested is list disqualify, not global DNC", () => {
    const e = getCallResultSideEffects("not_interested");
    expect(e.membershipStage).toBe("disqualified");
    expect(e.setDoNotContact).toBe(false);
  });

  it("do_not_contact sets global DNC without stage change", () => {
    const e = getCallResultSideEffects("do_not_contact");
    expect(e.setDoNotContact).toBe(true);
    expect(e.membershipStage).toBe("unchanged");
  });

  it("wrong_number marks phone invalid, keeps stage", () => {
    const e = getCallResultSideEffects("wrong_number");
    expect(e.setPhoneInvalid).toBe(true);
    expect(e.membershipStage).toBe("unchanged");
  });

  it("connected-class includes contact outcomes", () => {
    expect(isConnectedClassResult("connected")).toBe(true);
    expect(isConnectedClassResult("appointment")).toBe(true);
    expect(isConnectedClassResult("no_answer")).toBe(false);
  });

  it("validates result keys", () => {
    expect(isCallResult("no_answer")).toBe(true);
    expect(isCallResult("bogus")).toBe(false);
  });
});

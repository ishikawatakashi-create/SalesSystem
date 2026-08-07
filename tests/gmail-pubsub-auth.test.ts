import { describe, expect, it } from "vitest";

import { parsePubSubPushBody } from "@/lib/integrations/gmail/pubsub-envelope";

describe("parsePubSubPushBody", () => {
  it("正常な Pub/Sub envelope をパースする", () => {
    const data = Buffer.from(
      JSON.stringify({ emailAddress: "x@example.com", historyId: 12345 }),
    ).toString("base64");
    const parsed = parsePubSubPushBody({
      message: { data, messageId: "m1" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.messageId).toBe("m1");
      expect(parsed.historyId).toBe("12345");
      expect(parsed.emailAddress).toBe("x@example.com");
    }
  });

  it("malformed / missing fields を拒否する", () => {
    expect(parsePubSubPushBody(null).ok).toBe(false);
    expect(parsePubSubPushBody({}).ok).toBe(false);
    expect(
      parsePubSubPushBody({ message: { data: "%%%", messageId: "m" } }).ok,
    ).toBe(false);
    const data = Buffer.from(JSON.stringify({})).toString("base64");
    expect(
      parsePubSubPushBody({ message: { data, messageId: "m" } }).ok,
    ).toBe(false);
  });

  it("duplicate notification 用に messageId を安定取得する", () => {
    const data = Buffer.from(
      JSON.stringify({ historyId: "9" }),
    ).toString("base64");
    const a = parsePubSubPushBody({
      message: { data, message_id: "same" },
    });
    const b = parsePubSubPushBody({
      message: { data, messageId: "same" },
    });
    expect(a.ok && b.ok && a.messageId === b.messageId).toBe(true);
  });
});

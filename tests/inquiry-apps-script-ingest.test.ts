import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { signInquiryRequest } from "@/lib/inquiries/apps-script-hmac";

const SECRET = "unit-test-secret-16b";

vi.mock("@/lib/inquiries/ingest", () => ({
  ingestInquiryFromMail: vi.fn(async (input: { sourceMessageId: string }) => {
    const created = input.sourceMessageId !== "dup-msg";
    return {
      created,
      inquiry: {
        id: "inq-1",
        source_message_id: input.sourceMessageId,
        status: "new",
      },
    };
  }),
}));

vi.mock("@/lib/inquiries/apps-script-settings", () => ({
  patchInquiryAppsScriptSettings: vi.fn(async () => ({})),
  getInquiryAppsScriptSettings: vi.fn(async () => ({
    integration_mode: "apps_script_polling",
    last_heartbeat_at: null,
    last_ingest_at: null,
  })),
  countInquiriesReceivedSince: vi.fn(async () => 0),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: vi.fn(async () => ({ error: null })),
    }),
  }),
}));

import { handleAppsScriptIngestPost } from "@/lib/inquiries/apps-script-handler";
import { ingestInquiryFromMail } from "@/lib/inquiries/ingest";
import { patchInquiryAppsScriptSettings } from "@/lib/inquiries/apps-script-settings";

function signedRequest(bodyObj: unknown): Request {
  const rawBody = JSON.stringify(bodyObj);
  const ts = String(Date.now());
  const sig = signInquiryRequest(ts, rawBody, SECRET);
  return new Request("https://example.test/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-salessystem-timestamp": ts,
      "x-salessystem-signature": sig,
    },
    body: rawBody,
  });
}

describe("handleAppsScriptIngestPost", () => {
  beforeEach(() => {
    process.env.INQUIRY_APPS_SCRIPT_SECRET = SECRET;
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.INQUIRY_APPS_SCRIPT_SECRET;
  });

  it("heartbeat を受け付ける", async () => {
    const res = await handleAppsScriptIngestPost(
      signedRequest({ type: "heartbeat" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("heartbeat_ok");
    expect(patchInquiryAppsScriptSettings).toHaveBeenCalled();
  });

  it("inquiry を accepted する", async () => {
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "msg-1",
        gmail_thread_id: "th-1",
        received_at: new Date().toISOString(),
        from: "Strikingly <noreply@example.com>",
        reply_to: "a@example.test",
        subject: "New Form Submission",
        plain_body: "名前: A\nお問い合わせ内容: hello",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(ingestInquiryFromMail).toHaveBeenCalledTimes(1);
  });

  it("duplicate message は duplicate", async () => {
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "dup-msg",
        received_at: new Date().toISOString(),
        plain_body: "x",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("duplicate");
  });

  it("署名なしは 401", async () => {
    const res = await handleAppsScriptIngestPost(
      new Request("https://example.test/api", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("secret 未設定は 503", async () => {
    delete process.env.INQUIRY_APPS_SCRIPT_SECRET;
    const res = await handleAppsScriptIngestPost(
      signedRequest({ type: "heartbeat" }),
    );
    expect(res.status).toBe(503);
  });

  it("validation failure は 400", async () => {
    const res = await handleAppsScriptIngestPost(
      signedRequest({ gmail_message_id: "" }),
    );
    expect(res.status).toBe(400);
  });
});

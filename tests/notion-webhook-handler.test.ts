import { describe, expect, it, vi, beforeEach } from "vitest";
import { signWebhookPayload } from "@notionhq/client";

vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
    from: fromMock,
  }),
}));

describe("notion webhook handler", () => {
  const token = "test_phase7_verification_token_handler";

  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    process.env.NOTION_WEBHOOK_SECRET = token;
  });

  it("verification_token handshake は署名なしで 200 と vault store", async () => {
    rpcMock.mockResolvedValue({ data: { status: "received" }, error: null });
    const { handleNotionWebhookPost } = await import(
      "@/lib/webhooks/notion-webhook-handler"
    );
    const raw = JSON.stringify({
      verification_token: "test_phase7_handshake_token_zzzz",
    });
    const result = await handleNotionWebhookPost(
      new Request("http://localhost/api/webhooks/notion", {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "store_notion_webhook_verification_token",
      expect.objectContaining({ p_token: expect.any(String) }),
    );
    // レスポンスにトークンを含めない
    expect(JSON.stringify(result.body)).not.toContain("handshake_token");
  });

  it("署名なし通常イベントは 401", async () => {
    const { handleNotionWebhookPost } = await import(
      "@/lib/webhooks/notion-webhook-handler"
    );
    const raw = JSON.stringify({
      id: "test_phase7_webhook_unsigned",
      type: "page.created",
      entity: { id: "page_x", type: "page" },
    });
    const result = await handleNotionWebhookPost(
      new Request("http://localhost/api/webhooks/notion", {
        method: "POST",
        body: raw,
      }),
    );
    expect(result.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalledWith(
      "ingest_webhook_event",
      expect.anything(),
    );
  });

  it("署名付きイベントは ingest_webhook_event を呼ぶ", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "ingest_webhook_event") {
        return { data: "job-uuid", error: null };
      }
      return { data: null, error: null };
    });
    const { handleNotionWebhookPost } = await import(
      "@/lib/webhooks/notion-webhook-handler"
    );
    const raw = JSON.stringify({
      id: "test_phase7_webhook_signed",
      type: "page.properties_updated",
      entity: { id: "page_y", type: "page" },
      timestamp: "2026-08-07T00:00:00.000Z",
    });
    const signature = await signWebhookPayload({
      body: raw,
      verificationToken: token,
    });
    const result = await handleNotionWebhookPost(
      new Request("http://localhost/api/webhooks/notion", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "x-notion-signature": signature,
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "ingest_webhook_event",
      expect.objectContaining({
        p_event_id: "test_phase7_webhook_signed",
        p_event_type: "page.properties_updated",
      }),
    );
  });

  it("GET 相当は methodNotAllowed 405", async () => {
    const { methodNotAllowed } = await import(
      "@/lib/webhooks/notion-webhook-handler"
    );
    expect(methodNotAllowed().status).toBe(405);
  });
});

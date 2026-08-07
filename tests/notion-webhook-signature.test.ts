import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { signWebhookPayload } from "@notionhq/client";

vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
  }),
}));

describe("notion webhook signature", () => {
  const token = "test_phase7_verification_token_abc123";

  beforeEach(() => {
    rpcMock.mockReset();
    delete process.env.NOTION_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.NOTION_WEBHOOK_SECRET;
  });

  it("env の NOTION_WEBHOOK_SECRET を優先する", async () => {
    process.env.NOTION_WEBHOOK_SECRET = token;
    const { getNotionWebhookVerificationToken } = await import(
      "@/lib/webhooks/notion-signature"
    );
    const resolved = await getNotionWebhookVerificationToken();
    expect(resolved).toBe(token);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("env 未設定時は vault RPC を読む", async () => {
    rpcMock.mockResolvedValue({ data: token, error: null });
    const { getNotionWebhookVerificationToken } = await import(
      "@/lib/webhooks/notion-signature"
    );
    const resolved = await getNotionWebhookVerificationToken();
    expect(resolved).toBe(token);
    expect(rpcMock).toHaveBeenCalledWith(
      "read_notion_webhook_verification_token",
    );
  });

  it("signWebhookPayload で署名した body を verify できる", async () => {
    process.env.NOTION_WEBHOOK_SECRET = token;
    const body = JSON.stringify({
      id: "test_phase7_webhook_evt_1",
      type: "page.created",
      entity: { id: "page_1", type: "page" },
    });
    const signature = await signWebhookPayload({
      body,
      verificationToken: token,
    });

    const { verifyNotionWebhookSignature } = await import(
      "@/lib/webhooks/notion-signature"
    );
    const ok = await verifyNotionWebhookSignature({
      rawBody: body,
      signatureHeader: signature,
    });
    expect(ok).toBe(true);
  });

  it("改ざん body は検証失敗する", async () => {
    process.env.NOTION_WEBHOOK_SECRET = token;
    const body = JSON.stringify({
      id: "test_phase7_webhook_evt_2",
      type: "page.created",
    });
    const signature = await signWebhookPayload({
      body,
      verificationToken: token,
    });
    const { verifyNotionWebhookSignature } = await import(
      "@/lib/webhooks/notion-signature"
    );
    const ok = await verifyNotionWebhookSignature({
      rawBody: body.replace("page.created", "page.deleted"),
      signatureHeader: signature,
    });
    expect(ok).toBe(false);
  });
});

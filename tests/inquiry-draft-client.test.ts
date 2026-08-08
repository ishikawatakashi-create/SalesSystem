import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({
  insert: insertMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import {
  createGmailReplyDraft,
  fetchDraftFromAliases,
} from "@/lib/inquiries/apps-script-draft-client";

describe("apps-script draft client", () => {
  beforeEach(() => {
    process.env.INQUIRY_APPS_SCRIPT_DRAFT_URL = "https://script.example/exec";
    process.env.INQUIRY_APPS_SCRIPT_DRAFT_SECRET = "draft-unit-test-secret";
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          primary: "primary@example.test",
          aliases: ["primary@example.test", "alias@example.test"],
        }),
      })),
    );
  });

  afterEach(() => {
    delete process.env.INQUIRY_APPS_SCRIPT_DRAFT_URL;
    delete process.env.INQUIRY_APPS_SCRIPT_DRAFT_SECRET;
    vi.unstubAllGlobals();
  });

  it("aliases allowlist を返す", async () => {
    const r = await fetchDraftFromAliases();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aliases).toContain("alias@example.test");
    expect(r.primary).toBe("primary@example.test");
  });

  it("invalid_from を拒否", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_from" }),
      })),
    );
    const r = await createGmailReplyDraft({
      gmailMessageId: "msg-1",
      fromAddress: "evil@example.test",
      body: "x",
      requestId: "req-1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_from");
  });

  it("draft create を mock 成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "draft_created" }),
      })),
    );
    const r = await createGmailReplyDraft({
      gmailMessageId: "msg-1",
      fromAddress: "alias@example.test",
      body: "hello",
      requestId: "req-2",
    });
    expect(r.ok).toBe(true);
  });

  it("replay nonce を拒否", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const r = await createGmailReplyDraft({
      gmailMessageId: "msg-1",
      fromAddress: "alias@example.test",
      body: "hello",
      requestId: "req-3",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("replay_nonce");
  });
});

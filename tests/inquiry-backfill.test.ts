import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { looksLikeStrikinglyNotification } from "@/lib/inquiries/parser-strikingly";
import { isInquiryBadgeEligible } from "@/lib/inquiries/types";
import {
  applyBackfillPageResult,
  createBackfillProgress,
  recordRetryableFailure,
} from "@/lib/inquiries/apps-script-backfill-state";
import { signInquiryRequest } from "@/lib/inquiries/apps-script-hmac";

const SECRET = "unit-test-secret-16b";

vi.mock("@/lib/inquiries/ingest", () => ({
  ingestInquiryFromMail: vi.fn(),
}));

vi.mock("@/lib/inquiries/apps-script-settings", () => ({
  patchInquiryAppsScriptSettings: vi.fn(async () => ({})),
  getInquiryAppsScriptSettings: vi.fn(async () => ({
    integration_mode: "apps_script_polling",
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

describe("Strikingly candidate detection (backfill)", () => {
  it("日本語通知フレーズを検出する（From 非依存）", () => {
    expect(
      looksLikeStrikinglyNotification({
        subject: "通知",
        from: "sales@in-iru.com",
        body: "山田さんがあなたのサイトにコメントしました",
      }),
    ).toBe(true);
  });

  it("非 Strikingly は false", () => {
    expect(
      looksLikeStrikinglyNotification({
        subject: "請求書",
        from: "sales@in-iru.com",
        body: "今月の請求です",
      }),
    ).toBe(false);
  });
});

describe("badge eligibility", () => {
  it("通常の new は badge 対象", () => {
    expect(
      isInquiryBadgeEligible({ status: "new", historical_import: false }),
    ).toBe(true);
  });

  it("historical_import の new は badge 対象外（status は new のまま）", () => {
    expect(
      isInquiryBadgeEligible({ status: "new", historical_import: true }),
    ).toBe(false);
  });
});

describe("backfill progress continuation", () => {
  it("chunk 後に offset が進み running のまま", () => {
    const p0 = createBackfillProgress();
    const p1 = applyBackfillPageResult(p0, {
      threadsInPage: 20,
      threadsFullyHandled: 15,
      pageSize: 20,
      stopEarly: true,
      delta: { processed: 40, accepted: 10, duplicate: 5, skipped: 25 },
    });
    expect(p1.thread_offset).toBe(15);
    expect(p1.status).toBe("running");
    expect(p1.completed).toBe(false);
    expect(p1.accepted).toBe(10);
    expect(p1.skipped).toBe(25);
  });

  it("最終ページで completed", () => {
    const p0 = createBackfillProgress();
    p0.thread_offset = 100;
    const p1 = applyBackfillPageResult(p0, {
      threadsInPage: 3,
      threadsFullyHandled: 3,
      pageSize: 20,
      stopEarly: false,
      delta: { processed: 5, accepted: 2, duplicate: 3 },
    });
    expect(p1.status).toBe("completed");
    expect(p1.completed).toBe(true);
    expect(p1.thread_offset).toBe(103);
  });

  it("resume: 既存 progress から加算できる", () => {
    let p = createBackfillProgress();
    p = applyBackfillPageResult(p, {
      threadsInPage: 20,
      threadsFullyHandled: 20,
      pageSize: 20,
      stopEarly: false,
      delta: { processed: 40, accepted: 8, duplicate: 12, skipped: 20 },
    });
    p = applyBackfillPageResult(p, {
      threadsInPage: 5,
      threadsFullyHandled: 5,
      pageSize: 20,
      stopEarly: false,
      delta: { processed: 8, accepted: 1, duplicate: 7 },
    });
    expect(p.processed).toBe(48);
    expect(p.accepted).toBe(9);
    expect(p.completed).toBe(true);
  });

  it("retryable failure は offset を進めない", () => {
    const p0 = createBackfillProgress();
    p0.thread_offset = 10;
    const p1 = recordRetryableFailure(p0);
    expect(p1.thread_offset).toBe(10);
    expect(p1.failed).toBe(1);
    expect(p1.completed).toBe(false);
  });

  it("completed 後の再適用は完了のまま", () => {
    const done = applyBackfillPageResult(createBackfillProgress(), {
      threadsInPage: 0,
      threadsFullyHandled: 0,
      pageSize: 20,
      stopEarly: false,
      delta: {},
    });
    expect(done.completed).toBe(true);
    const again = applyBackfillPageResult(done, {
      threadsInPage: 20,
      threadsFullyHandled: 20,
      pageSize: 20,
      stopEarly: false,
      delta: { processed: 1 },
    });
    expect(again.completed).toBe(true);
    expect(again.processed).toBe(0);
  });
});

describe("Apps Script historical ingest handler", () => {
  beforeEach(() => {
    process.env.INQUIRY_APPS_SCRIPT_SECRET = SECRET;
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.INQUIRY_APPS_SCRIPT_SECRET;
  });

  it("historical message を accepted し historicalImport を渡す", async () => {
    vi.mocked(ingestInquiryFromMail).mockResolvedValueOnce({
      status: "accepted",
      inquiry: {
        id: "inq-h1",
        source_message_id: "hist-1",
        status: "new",
        historical_import: true,
        received_at: "2024-01-15T03:00:00.000Z",
      } as never,
    });

    const receivedAt = "2024-01-15T03:00:00.000Z";
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "hist-1",
        received_at: receivedAt,
        subject: "あなたのサイトにコメントしました",
        plain_body: "名前: A\nお問い合わせ内容: hello",
        historical_import: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(ingestInquiryFromMail).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageId: "hist-1",
        receivedAt,
        historicalImport: true,
        requireStrikingly: true,
      }),
    );
  });

  it("non-Strikingly skip", async () => {
    vi.mocked(ingestInquiryFromMail).mockResolvedValueOnce({
      status: "skipped",
      reason: "not_strikingly",
    });
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "other-1",
        received_at: new Date().toISOString(),
        subject: "請求書",
        plain_body: "ご請求",
        historical_import: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("skipped");
  });

  it("duplicate は正常", async () => {
    vi.mocked(ingestInquiryFromMail).mockResolvedValueOnce({
      status: "duplicate",
      inquiry: { id: "inq-1", source_message_id: "dup" } as never,
    });
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "dup",
        received_at: "2024-06-01T00:00:00.000Z",
        subject: "New Form Submission from Strikingly",
        plain_body: "x",
        historical_import: true,
      }),
    );
    expect(res.body.status).toBe("duplicate");
  });

  it("polling と backfill の競合でも duplicate で安全", async () => {
    vi.mocked(ingestInquiryFromMail).mockResolvedValueOnce({
      status: "duplicate",
      inquiry: { id: "inq-1", source_message_id: "same" } as never,
    });
    const res = await handleAppsScriptIngestPost(
      signedRequest({
        gmail_message_id: "same",
        received_at: "2024-06-01T00:00:00.000Z",
        subject: "Form submission from Strikingly",
        plain_body: "x",
        historical_import: false,
      }),
    );
    expect(res.body.status).toBe("duplicate");
  });
});

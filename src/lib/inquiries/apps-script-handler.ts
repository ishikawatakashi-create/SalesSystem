import "server-only";

import { z } from "zod";

import { verifyInquiryHmac } from "@/lib/inquiries/apps-script-hmac";
import { ingestInquiryFromMail } from "@/lib/inquiries/ingest";
import {
  countInquiriesReceivedSince,
  getInquiryAppsScriptSettings,
  patchInquiryAppsScriptSettings,
} from "@/lib/inquiries/apps-script-settings";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 200_000;
const MAX_BATCH = 20;
const MAX_PLAIN_CHARS = 50_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

/** プロセス内簡易 rate limit（未認証連打の負荷軽減）。HMAC 失敗は DB を触らない。 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function allowRate(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

const messageSchema = z.object({
  type: z.enum(["inquiry"]).optional(),
  source: z.enum(["strikingly_email"]).optional(),
  gmail_message_id: z.string().min(1).max(200),
  gmail_thread_id: z.string().max(200).nullable().optional(),
  received_at: z.string().min(1).max(64),
  // Gmail From ヘッダは表示名が長くなり得る
  from: z.string().max(2000).nullable().optional(),
  reply_to: z.string().max(2000).nullable().optional(),
  subject: z.string().max(2000).nullable().optional(),
  plain_body: z.string().max(MAX_PLAIN_CHARS).nullable().optional(),
  /** 過去 backfill。true のとき badge 対象外 */
  historical_import: z.boolean().optional(),
});

const heartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  timestamp: z.string().max(64).optional(),
});

const batchSchema = z.object({
  type: z.literal("batch"),
  items: z.array(messageSchema).min(1).max(MAX_BATCH),
});

export type AppsScriptHandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

function inquirySecret(): string | null {
  const v = process.env.INQUIRY_APPS_SCRIPT_SECRET?.trim();
  return v && v.length >= 16 ? v : null;
}

function methodNotAllowed(): AppsScriptHandlerResult {
  return { status: 405, body: { error: "method_not_allowed" } };
}

async function recordIngestError(code: string): Promise<void> {
  await patchInquiryAppsScriptSettings({
    last_error_code: code.slice(0, 80),
    last_error_at: new Date().toISOString(),
  });
  const admin = createAdminClient();
  await admin.from("sync_errors").insert({
    stage: "inquiry.apps_script",
    entity_type: "inquiry",
    notion_page_id: null,
    external_id: null,
    message: "Apps Script 取込でエラーが発生しました",
    detail: { code: code.slice(0, 80) },
  });
}

async function handleOneMessage(
  msg: z.infer<typeof messageSchema>,
): Promise<"accepted" | "duplicate" | "skipped"> {
  const result = await ingestInquiryFromMail({
    sourceMessageId: msg.gmail_message_id,
    sourceThreadId: msg.gmail_thread_id ?? null,
    receivedAt: msg.received_at,
    subject: msg.subject ?? null,
    from: msg.from ?? null,
    replyTo: msg.reply_to ?? null,
    plainText: msg.plain_body ?? null,
    htmlText: null,
    historicalImport: Boolean(msg.historical_import),
    requireStrikingly: true,
  });
  const now = new Date().toISOString();
  if (result.status === "skipped") {
    return "skipped";
  }
  if (result.status === "accepted") {
    await patchInquiryAppsScriptSettings({
      last_ingest_at: now,
      last_accepted_at: now,
      last_error_code: null,
    });
    return "accepted";
  }
  await patchInquiryAppsScriptSettings({
    last_ingest_at: now,
    last_duplicate_at: now,
  });
  return "duplicate";
}

/**
 * Apps Script 取込。本文・署名・secret はログしない。
 */
export async function handleAppsScriptIngestPost(
  request: Request,
): Promise<AppsScriptHandlerResult> {
  const secret = inquirySecret();
  if (!secret) {
    return { status: 503, body: { error: "not_configured" } };
  }

  if (!allowRate(clientKey(request))) {
    return { status: 429, body: { error: "rate_limited" } };
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "payload_too_large" } };
  }

  const verified = verifyInquiryHmac({
    timestamp: request.headers.get("x-salessystem-timestamp"),
    signature: request.headers.get("x-salessystem-signature"),
    rawBody,
    secret,
  });
  if (!verified.ok) {
    const authError =
      verified.reason === "bad_signature"
        ? "invalid_signature"
        : verified.reason === "stale_timestamp"
          ? "stale_timestamp"
          : verified.reason === "missing_signature"
            ? "missing_signature"
            : verified.reason === "missing_timestamp"
              ? "missing_timestamp"
              : "unauthorized";
    return { status: 401, body: { error: authError } };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  // heartbeat
  const hb = heartbeatSchema.safeParse(json);
  if (hb.success) {
    await patchInquiryAppsScriptSettings({
      last_heartbeat_at: new Date().toISOString(),
      last_error_code: null,
    });
    return { status: 200, body: { status: "heartbeat_ok" } };
  }

  // batch
  const batch = batchSchema.safeParse(json);
  if (batch.success) {
    const results: Array<"accepted" | "duplicate" | "skipped"> = [];
    try {
      for (const item of batch.data.items) {
        results.push(await handleOneMessage(item));
      }
    } catch {
      await recordIngestError("db_insert_failed");
      return { status: 500, body: { error: "db_insert_failed" } };
    }
    return {
      status: 200,
      body: {
        status: "ok",
        accepted: results.filter((r) => r === "accepted").length,
        duplicate: results.filter((r) => r === "duplicate").length,
        skipped: results.filter((r) => r === "skipped").length,
      },
    };
  }

  // single inquiry
  const single = messageSchema.safeParse(json);
  if (!single.success) {
    await recordIngestError("invalid_payload");
    return { status: 400, body: { error: "invalid_payload" } };
  }

  try {
    const result = await handleOneMessage(single.data);
    return { status: 200, body: { status: result } };
  } catch {
    await recordIngestError("db_insert_failed");
    return { status: 500, body: { error: "db_insert_failed" } };
  }
}

export async function getAppsScriptHealthSummary(): Promise<{
  integrationMode: string;
  lastHeartbeatAt: string | null;
  lastIngestAt: string | null;
  received24h: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  secretConfigured: boolean;
}> {
  const settings = await getInquiryAppsScriptSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const received24h = await countInquiriesReceivedSince(since);
  return {
    integrationMode: settings.integration_mode ?? "apps_script_polling",
    lastHeartbeatAt: settings.last_heartbeat_at ?? null,
    lastIngestAt: settings.last_ingest_at ?? null,
    received24h,
    lastErrorCode: settings.last_error_code ?? null,
    lastErrorAt: settings.last_error_at ?? null,
    secretConfigured: Boolean(inquirySecret()),
  };
}

export { methodNotAllowed };

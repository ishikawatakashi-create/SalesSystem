import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildSignedDraftEnvelope } from "@/lib/inquiries/draft-hmac";

function draftUrl(): string | null {
  const v = process.env.INQUIRY_APPS_SCRIPT_DRAFT_URL?.trim();
  return v && /^https:\/\//i.test(v) ? v.replace(/\/$/, "") : null;
}

function draftSecret(): string | null {
  const v = process.env.INQUIRY_APPS_SCRIPT_DRAFT_SECRET?.trim();
  return v && v.length >= 16 ? v : null;
}

export function isDraftIntegrationConfigured(): boolean {
  return Boolean(draftUrl() && draftSecret());
}

async function reserveNonce(nonce: string, purpose: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("apps_script_request_nonces").insert({
    nonce,
    purpose,
  });
  if (error) {
    // unique violation = replay
    if (error.code === "23505") return false;
    throw new Error("nonce_reserve_failed");
  }
  return true;
}

async function callAppsScript(payload: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const url = draftUrl();
  const secret = draftSecret();
  if (!url || !secret) {
    return {
      ok: false,
      status: 503,
      body: { error: "draft_not_configured" },
    };
  }

  const envelope = buildSignedDraftEnvelope({ payload, secret });
  const reserved = await reserveNonce(envelope.nonce, String(payload.action ?? "draft"));
  if (!reserved) {
    return { ok: false, status: 409, body: { error: "replay_nonce" } };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(envelope),
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { error: "invalid_json_response" };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function fetchDraftFromAliases(): Promise<{
  ok: true;
  aliases: string[];
  primary: string | null;
} | { ok: false; message: string }> {
  const result = await callAppsScript({ action: "list_aliases" });
  if (!result.ok) {
    const err = String(result.body.error ?? "alias_fetch_failed");
    return {
      ok: false,
      message:
        err === "draft_not_configured"
          ? "下書き連携が未設定です"
          : "送信元一覧の取得に失敗しました",
    };
  }
  const aliases = Array.isArray(result.body.aliases)
    ? result.body.aliases.filter((a): a is string => typeof a === "string")
    : [];
  const primary =
    typeof result.body.primary === "string" ? result.body.primary : null;
  return { ok: true, aliases, primary };
}

export async function createGmailReplyDraft(input: {
  gmailMessageId: string;
  fromAddress: string;
  body: string;
  requestId: string;
}): Promise<
  | { ok: true }
  | { ok: false; message: string; code?: string }
> {
  const result = await callAppsScript({
    action: "create_reply_draft",
    gmail_message_id: input.gmailMessageId,
    from: input.fromAddress,
    body: input.body,
    request_id: input.requestId,
  });
  if (!result.ok) {
    const code = String(result.body.error ?? "draft_create_failed");
    const messages: Record<string, string> = {
      draft_not_configured: "下書き連携が未設定です",
      invalid_from: "選択した送信元は利用できません",
      message_not_found: "元メールが見つかりませんでした",
      replay_nonce: "不正な再送リクエストです",
      unauthorized: "下書き連携の認証に失敗しました",
    };
    return {
      ok: false,
      code,
      message: messages[code] ?? "Gmail下書きの作成に失敗しました",
    };
  }
  return { ok: true };
}

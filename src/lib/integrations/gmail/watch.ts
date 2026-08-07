import "server-only";

import {
  gcpProjectId,
  gmailPubSubTopic,
} from "@/lib/integrations/gmail/env";
import { gmailPostJson } from "@/lib/integrations/gmail/client";
import {
  getGmailSettings,
  patchGmailSettings,
} from "@/lib/integrations/gmail/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type WatchResponse = {
  historyId?: string;
  expiration?: string;
};

/**
 * users.watch — label 未設定 / ingestion 無効なら開始しない。
 */
export async function renewGmailWatch(): Promise<{
  ok: boolean;
  reason?: string;
  historyId?: string;
  expiration?: string;
}> {
  const settings = await getGmailSettings();
  if (settings.status !== "connected") {
    return { ok: false, reason: "not_connected" };
  }
  if (!settings.label_id) {
    return { ok: false, reason: "label_not_selected" };
  }
  if (!settings.ingestion_enabled) {
    return { ok: false, reason: "ingestion_disabled" };
  }

  const project = gcpProjectId();
  const topic = gmailPubSubTopic();
  if (!project || !topic) {
    return { ok: false, reason: "env_missing" };
  }

  const topicName = topic.startsWith("projects/")
    ? topic
    : `projects/${project}/topics/${topic}`;

  try {
    const res = await gmailPostJson<WatchResponse>(
      "/gmail/v1/users/me/watch",
      {
        topicName,
        labelIds: [settings.label_id],
        labelFilterBehavior: "include",
      },
    );
    const historyId = res.historyId ? String(res.historyId) : null;
    const expirationMs = res.expiration ? Number(res.expiration) : NaN;
    const expiration = Number.isFinite(expirationMs)
      ? new Date(expirationMs).toISOString()
      : null;

    await patchGmailSettings({
      history_id: historyId ?? settings.history_id,
      last_history_id: settings.last_history_id ?? historyId,
      watch_expiration: expiration,
      last_error_code: null,
    });
    return {
      ok: true,
      historyId: historyId ?? undefined,
      expiration: expiration ?? undefined,
    };
  } catch (e) {
    const code = e instanceof Error ? e.message : "watch_failed";
    await patchGmailSettings({
      last_error_code: code.slice(0, 80),
      last_error_at: new Date().toISOString(),
    });
    const admin = createAdminClient();
    await admin.from("sync_errors").insert({
      stage: "gmail.watch.renew",
      entity_type: "gmail",
      notion_page_id: null,
      external_id: null,
      message: "Gmail watch の更新に失敗しました",
      detail: { code: code.slice(0, 80) },
    });
    return { ok: false, reason: code };
  }
}

export function isWatchExpiringSoon(
  expirationIso: string | null | undefined,
  withinMs = 24 * 60 * 60 * 1000,
): boolean {
  if (!expirationIso) return true;
  const t = new Date(expirationIso).getTime();
  if (!Number.isFinite(t)) return true;
  return t - Date.now() <= withinMs;
}

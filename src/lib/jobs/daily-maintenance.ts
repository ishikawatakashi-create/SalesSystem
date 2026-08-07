import "server-only";

import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWatchExpiringSoon } from "@/lib/integrations/gmail/watch";
import { getGmailSettings } from "@/lib/integrations/gmail/settings";

const SETTINGS_KEY = "daily_maintenance";

type DailyMaintenanceSettings = {
  lastStorageCleanupEnqueueDate?: string;
  lastStorageCleanupFinishedAt?: string;
  lastStorageCleanupCleaned?: number;
  lastStorageCleanupFailed?: number;
  lastGmailWatchRenewEnqueueDate?: string;
  lastGmailReconciliationEnqueueDate?: string;
};

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 日次 storage_cleanup の idempotency_key (`storage_cleanup:YYYY-MM-DD`) */
export function storageCleanupIdempotencyKey(date: string): string {
  return `storage_cleanup:${date}`;
}

export function gmailWatchRenewIdempotencyKey(date: string): string {
  return `gmail_watch_renew:${date}`;
}

export function gmailReconciliationIdempotencyKey(date: string): string {
  return `gmail_reconciliation:${date}`;
}

/**
 * ワーカー起動時に呼ぶ日次メンテナンス。
 * storage_cleanup / gmail watch renew / reconciliation を1日1回 enqueue。
 */
export async function ensureDailyMaintenanceJobs(): Promise<{
  enqueuedStorageCleanup: boolean;
  enqueuedGmailWatchRenew: boolean;
  enqueuedGmailReconciliation: boolean;
}> {
  const admin = createAdminClient();
  const today = utcDateString();

  const { data: row } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();

  const current = (row?.value ?? {}) as DailyMaintenanceSettings;
  let enqueuedStorageCleanup = false;
  let enqueuedGmailWatchRenew = false;
  let enqueuedGmailReconciliation = false;
  const next: DailyMaintenanceSettings = { ...current };

  if (current.lastStorageCleanupEnqueueDate !== today) {
    await enqueueJob({
      kind: "storage_cleanup",
      payload: { scheduledDate: today, reason: "daily_maintenance" },
      idempotencyKey: storageCleanupIdempotencyKey(today),
      priority: 80,
    });
    next.lastStorageCleanupEnqueueDate = today;
    enqueuedStorageCleanup = true;
  }

  if (current.lastGmailWatchRenewEnqueueDate !== today) {
    await enqueueJob({
      kind: "gmail_watch_renew",
      payload: { scheduledDate: today, reason: "daily_maintenance" },
      idempotencyKey: gmailWatchRenewIdempotencyKey(today),
      priority: 70,
    });
    next.lastGmailWatchRenewEnqueueDate = today;
    enqueuedGmailWatchRenew = true;
  } else {
    try {
      const gmail = await getGmailSettings();
      if (
        gmail.ingestion_enabled &&
        gmail.label_id &&
        isWatchExpiringSoon(gmail.watch_expiration, 36 * 60 * 60 * 1000)
      ) {
        await enqueueJob({
          kind: "gmail_watch_renew",
          payload: { scheduledDate: today, reason: "expiring_soon" },
          idempotencyKey: `${gmailWatchRenewIdempotencyKey(today)}:expiring`,
          priority: 60,
        });
      }
    } catch {
      // settings 読取失敗は無視
    }
  }

  if (current.lastGmailReconciliationEnqueueDate !== today) {
    await enqueueJob({
      kind: "gmail_reconciliation",
      payload: { scheduledDate: today, reason: "daily_maintenance" },
      idempotencyKey: gmailReconciliationIdempotencyKey(today),
      priority: 85,
    });
    next.lastGmailReconciliationEnqueueDate = today;
    enqueuedGmailReconciliation = true;
  }

  if (
    enqueuedStorageCleanup ||
    enqueuedGmailWatchRenew ||
    enqueuedGmailReconciliation
  ) {
    await admin.from("system_settings").upsert({
      key: SETTINGS_KEY,
      value: next,
      updated_at: new Date().toISOString(),
    });
  }

  return {
    enqueuedStorageCleanup,
    enqueuedGmailWatchRenew,
    enqueuedGmailReconciliation,
  };
}

/** storage_cleanup 完了後に管理画面向け件数を記録（本文・path詳細は保存しない） */
export async function recordStorageCleanupResult(input: {
  cleaned: number;
  failed: number;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const current = (row?.value ?? {}) as DailyMaintenanceSettings;
  await admin.from("system_settings").upsert({
    key: SETTINGS_KEY,
    value: {
      ...current,
      lastStorageCleanupFinishedAt: new Date().toISOString(),
      lastStorageCleanupCleaned: input.cleaned,
      lastStorageCleanupFailed: input.failed,
    },
    updated_at: new Date().toISOString(),
  });
}

export async function getDailyMaintenanceSettings(): Promise<DailyMaintenanceSettings> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  return (row?.value ?? {}) as DailyMaintenanceSettings;
}

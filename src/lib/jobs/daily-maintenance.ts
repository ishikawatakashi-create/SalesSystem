import "server-only";

import { enqueueJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";

const SETTINGS_KEY = "daily_maintenance";

type DailyMaintenanceSettings = {
  lastStorageCleanupEnqueueDate?: string;
  lastStorageCleanupFinishedAt?: string;
  lastStorageCleanupCleaned?: number;
  lastStorageCleanupFailed?: number;
};

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 日次 storage_cleanup の idempotency_key (`storage_cleanup:YYYY-MM-DD`) */
export function storageCleanupIdempotencyKey(date: string): string {
  return `storage_cleanup:${date}`;
}

/**
 * ワーカー起動時に呼ぶ日次メンテナンス。
 * storage_cleanup を1日1回だけ enqueue（idempotency_key で多重防止）。
 * CSV本文・個人情報は扱わない。
 */
export async function ensureDailyMaintenanceJobs(): Promise<{
  enqueuedStorageCleanup: boolean;
}> {
  const admin = createAdminClient();
  const today = utcDateString();

  const { data: row } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();

  const current = (row?.value ?? {}) as DailyMaintenanceSettings;
  if (current.lastStorageCleanupEnqueueDate === today) {
    return { enqueuedStorageCleanup: false };
  }

  const idempotencyKey = storageCleanupIdempotencyKey(today);
  await enqueueJob({
    kind: "storage_cleanup",
    payload: { scheduledDate: today, reason: "daily_maintenance" },
    idempotencyKey,
    priority: 80,
  });

  const next: DailyMaintenanceSettings = {
    ...current,
    lastStorageCleanupEnqueueDate: today,
  };
  await admin.from("system_settings").upsert({
    key: SETTINGS_KEY,
    value: next,
    updated_at: new Date().toISOString(),
  });

  return { enqueuedStorageCleanup: true };
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

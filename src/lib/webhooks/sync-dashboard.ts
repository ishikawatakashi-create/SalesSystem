import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getDailyMaintenanceSettings } from "@/lib/jobs/daily-maintenance";
import {
  getSetupStatus,
  type NotionWebhookSetupStatus,
} from "@/lib/webhooks/verification-store";

/** 管理画面「同期状況」用。シークレット・payload は含めない。 */
export type SyncDashboardMetrics = {
  setupStatus: NotionWebhookSetupStatus;
  lastWebhookReceivedAt: string | null;
  lastWebhookSyncFinishedAt: string | null;
  pendingWebhookRelatedJobs: number;
  failedWebhookSyncRecent: number;
  lastReconciliationSuccessAt: string | null;
  unresolvedSchemaMismatch: number;
  unresolvedSyncErrors: number;
  jobsQueued: number;
  jobsRunning: number;
  jobsFailed: number;
  importJobsRunning: number;
  importJobsFailed: number;
  storageCleanupLastFinishedAt: string | null;
  storageCleanupLastCleaned: number | null;
  storageCleanupLastFailed: number | null;
  storageCleanupFailedErrors: number;
  pendingWebhookEvents: number;
  failedWebhookEvents: number;
};

const WEBHOOK_RELATED_KINDS = [
  "webhook_sync",
  "sync_repair",
  "reconciliation",
] as const;

const RECENT_FAILED_HOURS = 24;

export async function getSyncDashboardMetrics(): Promise<SyncDashboardMetrics> {
  const admin = createAdminClient();
  const setupStatus = await getSetupStatus();
  const maintenance = await getDailyMaintenanceSettings();

  const sinceFailed = new Date(
    Date.now() - RECENT_FAILED_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [
    lastWebhookRes,
    lastSyncJobRes,
    pendingJobsRes,
    failedJobsRes,
    reconAuditRes,
    reconJobRes,
    schemaMismatchRes,
    syncErrorsRes,
    jobsQueuedRes,
    jobsRunningRes,
    jobsFailedRes,
    importRunningRes,
    importFailedRes,
    cleanupErrRes,
    orphanWhRes,
  ] = await Promise.all([
    admin
      .from("webhook_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("jobs")
      .select("finished_at")
      .eq("kind", "webhook_sync")
      .eq("status", "succeeded")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("kind", [...WEBHOOK_RELATED_KINDS])
      .in("status", ["queued", "running"]),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "webhook_sync")
      .eq("status", "failed")
      .gte("updated_at", sinceFailed),
    admin
      .from("audit_logs")
      .select("created_at")
      .eq("action", "sync.reconciliation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("jobs")
      .select("finished_at")
      .eq("kind", "reconciliation")
      .eq("status", "succeeded")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("sync_errors")
      .select("id", { count: "exact", head: true })
      .eq("stage", "schema_mismatch")
      .is("resolved_at", null)
      .is("ignored_at", null),
    admin
      .from("sync_errors")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .is("ignored_at", null),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("import_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["importing", "validating", "ready"]),
    admin
      .from("import_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("sync_errors")
      .select("id", { count: "exact", head: true })
      .eq("stage", "storage_cleanup_failed")
      .is("resolved_at", null)
      .is("ignored_at", null),
    admin
      .from("webhook_events")
      .select("event_id", { count: "exact", head: true })
      .is("job_id", null),
  ]);

  const lastReconciliationSuccessAt =
    (reconAuditRes.data?.created_at as string | undefined) ??
    (reconJobRes.data?.finished_at as string | undefined) ??
    null;

  return {
    setupStatus,
    lastWebhookReceivedAt:
      (lastWebhookRes.data?.received_at as string | undefined) ?? null,
    lastWebhookSyncFinishedAt:
      (lastSyncJobRes.data?.finished_at as string | undefined) ?? null,
    pendingWebhookRelatedJobs: pendingJobsRes.count ?? 0,
    failedWebhookSyncRecent: failedJobsRes.count ?? 0,
    lastReconciliationSuccessAt,
    unresolvedSchemaMismatch: schemaMismatchRes.count ?? 0,
    unresolvedSyncErrors: syncErrorsRes.count ?? 0,
    jobsQueued: jobsQueuedRes.count ?? 0,
    jobsRunning: jobsRunningRes.count ?? 0,
    jobsFailed: jobsFailedRes.count ?? 0,
    importJobsRunning: importRunningRes.count ?? 0,
    importJobsFailed: importFailedRes.count ?? 0,
    storageCleanupLastFinishedAt:
      maintenance.lastStorageCleanupFinishedAt ?? null,
    storageCleanupLastCleaned:
      maintenance.lastStorageCleanupCleaned ?? null,
    storageCleanupLastFailed: maintenance.lastStorageCleanupFailed ?? null,
    storageCleanupFailedErrors: cleanupErrRes.count ?? 0,
    pendingWebhookEvents: orphanWhRes.count ?? 0,
    failedWebhookEvents: failedJobsRes.count ?? 0,
  };
}

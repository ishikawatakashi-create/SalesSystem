import type { SyncDashboardMetrics } from "@/lib/webhooks/sync-dashboard";
import { webhookSetupStatusLabel } from "@/lib/admin-presentation";

function formatTs(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
  } catch {
    return "—";
  }
}

type Props = {
  metrics: SyncDashboardMetrics;
};

export function SyncMetricsPanel({ metrics }: Props) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Notion通知の設定状態",
      value: webhookSetupStatusLabel(metrics.setupStatus),
    },
    {
      label: "Notionからの最終通知受信",
      value: formatTs(metrics.lastWebhookReceivedAt),
    },
    {
      label: "最終データ同期成功",
      value: formatTs(metrics.lastWebhookSyncFinishedAt),
    },
    {
      label: "処理待ち・処理中の通知",
      value: String(metrics.pendingWebhookEvents),
    },
    {
      label: "処理に失敗した通知",
      value: String(metrics.failedWebhookEvents),
    },
    {
      label: "待機中の同期処理",
      value: String(metrics.pendingWebhookRelatedJobs),
    },
    {
      label: "直近24時間の同期失敗",
      value: String(metrics.failedWebhookSyncRecent),
    },
    {
      label: "最終整合性確認成功",
      value: formatTs(metrics.lastReconciliationSuccessAt),
    },
    {
      label: "未解決のデータ構造不一致",
      value: String(metrics.unresolvedSchemaMismatch),
    },
    {
      label: "未解決の同期エラー",
      value: String(metrics.unresolvedSyncErrors),
    },
    {
      label: "全バックグラウンド処理",
      value: `待機 ${metrics.jobsQueued} / 実行中 ${metrics.jobsRunning} / 失敗 ${metrics.jobsFailed}`,
    },
    {
      label: "CSV取込処理",
      value: `実行中 ${metrics.importJobsRunning} / 失敗 ${metrics.importJobsFailed}`,
    },
    {
      label: "一時ファイル整理の最終成功",
      value: formatTs(metrics.storageCleanupLastFinishedAt),
    },
    {
      label: "一時ファイル整理の削除件数（最終）",
      value:
        metrics.storageCleanupLastCleaned == null
          ? "—"
          : String(metrics.storageCleanupLastCleaned),
    },
    {
      label: "一時ファイル整理の失敗件数（最終）",
      value:
        metrics.storageCleanupLastFailed == null
          ? "—"
          : String(metrics.storageCleanupLastFailed),
    },
    {
      label: "未解決の一時ファイル整理エラー",
      value: String(metrics.storageCleanupFailedErrors),
    },
  ];

  return (
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4">
      <div>
        <h2 className="mb-1 text-sm font-bold">同期・運用状況</h2>
        <p className="text-xs text-slate-500">
          機密情報や処理内容の詳細は表示せず、件数と時刻だけを表示しています。
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <dt className="text-xs font-medium text-slate-500">{row.label}</dt>
            <dd className="text-sm text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>
      <details className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium">技術情報</summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <dt>通知設定状態コード</dt>
            <dd className="font-mono">{metrics.setupStatus}</dd>
          </div>
          <div>
            <dt>同期処理種別</dt>
            <dd className="font-mono">
              webhook_sync / sync_repair / reconciliation
            </dd>
          </div>
          <div>
            <dt>処理状態コード</dt>
            <dd className="font-mono">queued / running / failed</dd>
          </div>
          <div>
            <dt>CSV取込処理種別</dt>
            <dd className="font-mono">csv_import</dd>
          </div>
          <div>
            <dt>一時ファイル整理エラー種別</dt>
            <dd className="font-mono">storage_cleanup_failed</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

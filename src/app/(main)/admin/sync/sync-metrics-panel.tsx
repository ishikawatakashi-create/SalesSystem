import type { SyncDashboardMetrics } from "@/lib/webhooks/sync-dashboard";

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
    { label: "購読ステータス", value: metrics.setupStatus },
    {
      label: "最終 Webhook 受信",
      value: formatTs(metrics.lastWebhookReceivedAt),
    },
    {
      label: "最終 webhook_sync 成功",
      value: formatTs(metrics.lastWebhookSyncFinishedAt),
    },
    {
      label: "待機中の Webhook 関連ジョブ",
      value: String(metrics.pendingWebhookRelatedJobs),
    },
    {
      label: "失敗した webhook_sync(直近24h)",
      value: String(metrics.failedWebhookSyncRecent),
    },
    {
      label: "最終 reconciliation 成功",
      value: formatTs(metrics.lastReconciliationSuccessAt),
    },
    {
      label: "未解決 schema_mismatch",
      value: String(metrics.unresolvedSchemaMismatch),
    },
    {
      label: "未解決 sync_errors",
      value: String(metrics.unresolvedSyncErrors),
    },
  ];

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="mb-1 text-sm font-bold">同期状況メトリクス</h2>
        <p className="text-xs text-slate-500">
          シークレット・payload・個人情報は表示しません。件数と時刻のみです。
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <dt className="text-xs font-medium text-slate-500">{row.label}</dt>
            <dd className="text-sm text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

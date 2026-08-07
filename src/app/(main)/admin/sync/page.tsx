import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getSyncDashboardMetrics } from "@/lib/webhooks/sync-dashboard";
import { SyncMetricsPanel } from "./sync-metrics-panel";
import { WebhookSetupPanel } from "./webhook-setup-panel";

/** Notion 購読用の公開エンドポイント。localhost は使えないため本番URLへフォールバック。 */
function webhookEndpointUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (
    configured &&
    !/localhost|127\.0\.0\.1/i.test(configured)
  ) {
    return `${configured}/api/webhooks/notion`;
  }
  return "https://sales-system-weld.vercel.app/api/webhooks/notion";
}

export default async function AdminSyncPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "sync.manage")) {
      redirect("/");
    }
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/login");
    }
    throw e;
  }

  // トークンはSSRに載せない。状態メタデータと件数のみ取得する。
  const metrics = await getSyncDashboardMetrics();
  const endpointUrl = webhookEndpointUrl();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-base font-bold">同期管理</h1>
        <p className="text-xs text-slate-500">
          Notion Webhook の購読セットアップと同期関連の管理を行います。
        </p>
      </div>
      <SyncMetricsPanel metrics={metrics} />
      <WebhookSetupPanel
        status={metrics.setupStatus}
        endpointUrl={endpointUrl}
      />
    </div>
  );
}

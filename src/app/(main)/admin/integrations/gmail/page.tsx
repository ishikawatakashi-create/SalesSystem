import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getGmailSettings } from "@/lib/integrations/gmail/settings";
import { gmailEnvPresence } from "@/lib/integrations/gmail/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { GmailAdminPanel } from "@/features/admin/gmail/gmail-admin-panel";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

export default async function GmailIntegrationAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const sp = await searchParams;
  const connected = sp.connected === "1";
  const error =
    typeof sp.error === "string" ? sp.error : Array.isArray(sp.error) ? sp.error[0] : null;

  const settings = await getGmailSettings();
  const admin = createAdminClient();
  const { count: failedJobs } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("kind", [
      "gmail_history_sync",
      "gmail_watch_renew",
      "gmail_reconciliation",
    ])
    .eq("status", "failed");
  const { count: unresolvedErrors } = await admin
    .from("sync_errors")
    .select("id", { count: "exact", head: true })
    .like("stage", "gmail%")
    .is("resolved_at", null)
    .is("ignored_at", null);

  return (
    <div className="space-y-3">
      <Breadcrumbs
        items={[
          { label: "管理", href: "/admin/sync" },
          { label: "Gmail 連携" },
        ]}
      />
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">Gmail 連携（お問い合わせ）</h1>
        <Link
          href="/admin/sync"
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          同期管理へ
        </Link>
      </div>
      {connected && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Gmail 接続が完了しました。label を選択してから取り込みを開始してください。
        </div>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          接続エラー: {error}
        </div>
      )}
      <GmailAdminPanel
        settings={settings}
        envPresence={gmailEnvPresence()}
        failedJobs={failedJobs ?? 0}
        unresolvedErrors={unresolvedErrors ?? 0}
      />
    </div>
  );
}

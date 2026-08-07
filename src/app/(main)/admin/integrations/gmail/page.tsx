import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import { getAppsScriptHealthSummary } from "@/lib/inquiries/apps-script-handler";
import { AppsScriptHealthPanel } from "@/features/admin/inquiry-ingest/apps-script-health-panel";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

function endpointUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
    return `${configured}/api/integrations/inquiries/apps-script`;
  }
  return "https://sales-system-weld.vercel.app/api/integrations/inquiries/apps-script";
}

export default async function InquiryIngestAdminPage() {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const health = await getAppsScriptHealthSummary();

  return (
    <div className="space-y-3">
      <Breadcrumbs
        items={[
          { label: "管理", href: "/admin/sync" },
          { label: "お問い合わせ取込" },
        ]}
      />
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">お問い合わせ取込</h1>
        <Link
          href="/admin/sync"
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          同期管理へ
        </Link>
      </div>
      <AppsScriptHealthPanel
        {...health}
        endpointUrl={endpointUrl()}
      />
      <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <h2 className="mb-1 font-semibold text-slate-800">運用メモ</h2>
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            リポジトリの{" "}
            <code className="font-mono">
              integrations/apps-script/strikingly-inquiries/
            </code>{" "}
            を script.google.com へ配置
          </li>
          <li>Script Properties に endpoint / secret を設定（値はここに表示しない）</li>
          <li>Gmail で label「SalesSystem/お問い合わせ」とフィルタを作成</li>
          <li>
            過去取込は Apps Script で{" "}
            <code className="font-mono">backfillStrikinglyInquiries</code>{" "}
            を手動実行（自動開始しない）
          </li>
          <li>旧 Pub/Sub / Gmail OAuth 方式は廃止済み（DBメタは残置）</li>
        </ul>
      </section>
    </div>
  );
}

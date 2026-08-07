import Link from "next/link";

import { heartbeatHealth } from "@/lib/inquiries/apps-script-health";

export function AppsScriptHealthPanel({
  integrationMode,
  lastHeartbeatAt,
  lastIngestAt,
  received24h,
  lastErrorCode,
  lastErrorAt,
  secretConfigured,
  endpointUrl,
}: {
  integrationMode: string;
  lastHeartbeatAt: string | null;
  lastIngestAt: string | null;
  received24h: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  secretConfigured: boolean;
  endpointUrl: string;
}) {
  const hb = heartbeatHealth(lastHeartbeatAt);
  const hbLabel =
    hb === "ok" ? "正常" : hb === "delayed" ? "heartbeat遅延" : "未受信";

  return (
    <section className="rounded border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-800">
          お問い合わせ取込（Apps Script）
        </h2>
        <Link
          href="/admin/integrations/gmail"
          className="text-primary hover:underline"
        >
          詳細
        </Link>
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
        <dt className="text-slate-500">mode</dt>
        <dd>{integrationMode}</dd>
        <dt className="text-slate-500">endpoint</dt>
        <dd className="break-all font-mono text-[11px]">{endpointUrl}</dd>
        <dt className="text-slate-500">secret</dt>
        <dd>{secretConfigured ? "設定済" : "未設定"}</dd>
        <dt className="text-slate-500">heartbeat</dt>
        <dd>
          {hbLabel}
          {lastHeartbeatAt ? ` · ${lastHeartbeatAt}` : ""}
        </dd>
        <dt className="text-slate-500">最終 ingest</dt>
        <dd>{lastIngestAt || "—"}</dd>
        <dt className="text-slate-500">直近24h受信</dt>
        <dd>{received24h}件</dd>
        {lastErrorCode && (
          <>
            <dt className="text-slate-500">最終エラー</dt>
            <dd>
              {lastErrorCode}
              {lastErrorAt ? ` · ${lastErrorAt}` : ""}
            </dd>
          </>
        )}
      </dl>
      <p className="mt-2 text-slate-500">
        Gmail label「SalesSystem/お問い合わせ」を Apps Script が5分ごとに
        POST します。Pub/Sub / Gmail OAuth は使用しません。
      </p>
    </section>
  );
}

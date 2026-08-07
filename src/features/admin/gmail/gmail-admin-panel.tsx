"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  disconnectGmailAction,
  enqueueGmailReconciliationAction,
  loadGmailLabelsAction,
  renewGmailWatchAction,
  setGmailIngestionEnabledAction,
  setGmailLabelAction,
} from "@/features/admin/gmail/actions";
import type { GmailIntegrationSettings } from "@/lib/inquiries/types";

export function GmailAdminPanel({
  settings,
  envPresence,
  failedJobs,
  unresolvedErrors,
}: {
  settings: GmailIntegrationSettings;
  envPresence: Record<string, boolean>;
  failedJobs: number;
  unresolvedErrors: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [labelId, setLabelId] = useState(settings.label_id ?? "");

  const connected = settings.status === "connected";
  const needsReconnect =
    settings.needs_reconnect || settings.status === "needs_reconnect";

  return (
    <div className="space-y-3 text-xs">
      {msg && (
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
          {msg}
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">接続状態</h2>
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
          <dt className="text-slate-500">状態</dt>
          <dd>
            {needsReconnect
              ? "再接続が必要"
              : connected
                ? "接続済み"
                : "未接続"}
          </dd>
          <dt className="text-slate-500">メールボックス</dt>
          <dd>{settings.email_masked || "—"}</dd>
          <dt className="text-slate-500">label</dt>
          <dd>{settings.label_name || settings.label_id || "未選択"}</dd>
          <dt className="text-slate-500">取り込み</dt>
          <dd>{settings.ingestion_enabled ? "有効" : "無効"}</dd>
          <dt className="text-slate-500">watch 期限</dt>
          <dd>{settings.watch_expiration || "—"}</dd>
          <dt className="text-slate-500">最終 notification</dt>
          <dd>{settings.last_notification_at || "—"}</dd>
          <dt className="text-slate-500">最終 history sync</dt>
          <dd>{settings.last_history_sync_at || "—"}</dd>
          <dt className="text-slate-500">最終 reconciliation</dt>
          <dd>{settings.last_reconciliation_at || "—"}</dd>
          <dt className="text-slate-500">未処理/failed jobs</dt>
          <dd>{failedJobs}</dd>
          <dt className="text-slate-500">未解決 sync_errors</dt>
          <dd>{unresolvedErrors}</dd>
          {settings.last_error_code && (
            <>
              <dt className="text-slate-500">最終エラー</dt>
              <dd>{settings.last_error_code}</dd>
            </>
          )}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/api/integrations/gmail/oauth/start"
            className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
          >
            {connected ? "再接続" : "Gmail を接続"}
          </a>
          {connected && (
            <button
              type="button"
              disabled={pending}
              className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              onClick={() => {
                if (!confirm("Gmail 接続を解除しますか？")) return;
                start(async () => {
                  const r = await disconnectGmailAction();
                  setMsg(r.ok ? "接続を解除しました" : r.message);
                  router.refresh();
                });
              }}
            >
              接続解除
            </button>
          )}
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">label 選択</h2>
        <p className="mb-2 text-slate-500">
          Gmail 側で「SalesSystem/お問い合わせ」等の label とフィルタを作成し、ここで選択してください。未選択のまま取り込みを開始できません。
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            disabled={pending || !connected}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            onClick={() => {
              start(async () => {
                const r = await loadGmailLabelsAction();
                if (!r.ok) {
                  setMsg(r.message);
                  return;
                }
                setLabels(r.labels);
                setMsg(`${r.labels.length} 件の label を取得しました`);
              });
            }}
          >
            label 一覧を取得
          </button>
          <select
            className="min-w-[16rem] rounded border border-slate-300 px-2 py-1"
            value={labelId}
            disabled={!connected}
            onChange={(e) => setLabelId(e.target.value)}
          >
            <option value="">選択してください</option>
            {(labels.length
              ? labels
              : settings.label_id
                ? [{ id: settings.label_id, name: settings.label_name || settings.label_id }]
                : []
            ).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !labelId}
            className="rounded bg-primary px-3 py-1.5 text-white disabled:opacity-40"
            onClick={() => {
              const name =
                labels.find((l) => l.id === labelId)?.name ||
                settings.label_name ||
                labelId;
              start(async () => {
                const r = await setGmailLabelAction({
                  labelId,
                  labelName: name,
                });
                setMsg(r.ok ? "label を保存しました（取り込みは無効のまま）" : r.message);
                router.refresh();
              });
            }}
          >
            label を保存
          </button>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">取り込み / watch</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !connected || !settings.label_id}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
            onClick={() => {
              start(async () => {
                const r = await setGmailIngestionEnabledAction({
                  enabled: !settings.ingestion_enabled,
                });
                setMsg(
                  r.ok
                    ? settings.ingestion_enabled
                      ? "取り込みを無効化しました"
                      : "取り込みを有効化しました"
                    : r.message,
                );
                router.refresh();
              });
            }}
          >
            {settings.ingestion_enabled ? "取り込みを停止" : "取り込みを開始"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            onClick={() => {
              start(async () => {
                const r = await renewGmailWatchAction();
                setMsg(r.ok ? "watch を更新しました" : r.message);
                router.refresh();
              });
            }}
          >
            watch を更新
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            onClick={() => {
              start(async () => {
                const r = await enqueueGmailReconciliationAction();
                setMsg(r.ok ? r.message || "投入しました" : r.message);
                router.refresh();
              });
            }}
          >
            再同期（reconciliation）
          </button>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="mb-2 font-semibold">環境変数（有無のみ）</h2>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {Object.entries(envPresence).map(([k, ok]) => (
            <li key={k} className="flex justify-between gap-2 border-b border-slate-50 py-0.5">
              <span className="font-mono text-[11px]">{k}</span>
              <span className={ok ? "text-emerald-700" : "text-red-600"}>
                {ok ? "設定済" : "未設定"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

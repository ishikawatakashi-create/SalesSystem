"use client";

import { useState, useTransition } from "react";
import {
  markWebhookVerifiedAction,
  revealWebhookVerificationTokenAction,
  type WebhookSetupStatus,
} from "@/features/admin/sync/actions";

const STATUS_LABELS: Record<
  WebhookSetupStatus,
  { label: string; description: string }
> = {
  awaiting: {
    label: "待機中",
    description:
      "Notionからの verification トークン受信を待っています。下のエンドポイントURLをNotionのWebhook購読設定に登録してください。",
  },
  received: {
    label: "受信済み",
    description:
      "確認用トークンを受信しました。「確認する」で値を表示し、NotionのVerify画面へ貼り付けてください。Verify成功後に「検証完了にする」を押します。",
  },
  verified: {
    label: "検証完了",
    description:
      "Webhook購読の検証は完了しています。必要なら「確認する」で保存済みトークンを再表示できます。",
  },
};

type Props = {
  status: WebhookSetupStatus;
  endpointUrl: string;
};

export function WebhookSetupPanel({ status: initialStatus, endpointUrl }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [revealPending, startReveal] = useTransition();
  const [markPending, startMark] = useTransition();

  const statusMeta = STATUS_LABELS[status];
  const canReveal = status === "received" || status === "verified";
  const canMarkVerified = status === "received";

  function handleReveal() {
    setMessage(null);
    setCopied(false);
    startReveal(async () => {
      const result = await revealWebhookVerificationTokenAction();
      if (!result.ok) {
        setRevealedToken(null);
        setMessage({ ok: false, text: result.message });
        return;
      }
      // トークンはクライアントの一時 state のみ。localStorage / URL には載せない。
      setRevealedToken(result.token);
      setMessage(null);
    });
  }

  function handleMarkVerified() {
    setMessage(null);
    startMark(async () => {
      const result = await markWebhookVerifiedAction();
      if (!result.ok) {
        setMessage({ ok: false, text: result.message });
        return;
      }
      setStatus(result.status);
      setRevealedToken(null);
      setCopied(false);
      setMessage({
        ok: true,
        text: "セットアップ状態を「検証完了」に更新しました。",
      });
    });
  }

  async function handleCopyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopied(true);
    } catch {
      setMessage({
        ok: false,
        text: "クリップボードへコピーできませんでした。表示中の値を手動で選択してコピーしてください。",
      });
    }
  }

  async function handleCopyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpointUrl);
      setMessage({ ok: true, text: "エンドポイントURLをコピーしました。" });
    } catch {
      setMessage({
        ok: false,
        text: "エンドポイントURLをコピーできませんでした。",
      });
    }
  }

  return (
    <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="mb-1 text-sm font-bold">Notion Webhook 購読セットアップ</h2>
        <p className="text-xs text-slate-500">
          管理者のみ操作できます。確認用トークンは明示操作でのみ表示され、画面を離れると消えます。
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">セットアップ状態</p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              status === "verified"
                ? "rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-800"
                : status === "received"
                  ? "rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                  : "rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
            }
          >
            {statusMeta.label}
          </span>
          <span className="text-xs text-slate-500">({status})</span>
        </div>
        <p className="text-xs text-slate-600">{statusMeta.description}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">エンドポイントURL</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800">
            {endpointUrl}
          </code>
          <button
            type="button"
            onClick={() => void handleCopyEndpoint()}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          >
            URLをコピー
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canReveal || revealPending}
          onClick={handleReveal}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {revealPending ? "取得中…" : "確認する"}
        </button>
        {canMarkVerified && (
          <button
            type="button"
            disabled={markPending}
            onClick={handleMarkVerified}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {markPending ? "更新中…" : "検証完了にする"}
          </button>
        )}
      </div>

      {revealedToken && (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">確認用トークン</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded border border-amber-200 bg-white px-2 py-1 font-mono text-xs text-slate-900">
              {revealedToken}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyToken()}
              className="rounded border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100"
            >
              コピー
            </button>
            <button
              type="button"
              onClick={() => {
                setRevealedToken(null);
                setCopied(false);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
            >
              表示を消す
            </button>
          </div>
          {copied && (
            <p role="status" className="text-xs font-medium text-red-700">
              この値はNotionのVerify画面へ直接貼り付けてください。チャット・ドキュメント・チケットへ貼らないでください。
            </p>
          )}
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`text-xs ${message.ok ? "text-green-700" : "text-red-600"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

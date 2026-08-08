"use client";

import { useEffect, useId, useState, useTransition } from "react";

import {
  createInquiryReplyDraftAction,
  listInquiryDraftFromAliasesAction,
} from "@/features/inquiries/actions";

export function InquiryReplyDraftPanel({
  inquiryId,
  canEdit,
  draftConfigured,
}: {
  inquiryId: string;
  canEdit: boolean;
  draftConfigured: boolean;
}) {
  const requestBase = useId();
  const [pending, start] = useTransition();
  const [aliases, setAliases] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadingAliases, setLoadingAliases] = useState(
    () => canEdit && draftConfigured,
  );

  useEffect(() => {
    if (!canEdit || !draftConfigured) return;
    let cancelled = false;
    void listInquiryDraftFromAliasesAction().then((r) => {
      if (cancelled) return;
      setLoadingAliases(false);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setAliases(r.aliases);
      setPrimary(r.primary);
      const initial = r.primary || r.aliases[0] || "";
      setFrom(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [canEdit, draftConfigured]);

  if (!canEdit) return null;

  if (!draftConfigured) {
    return (
      <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        Gmail返信下書き連携は未設定です（管理者の Web App / secret 設定後に利用できます）。
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3 text-xs">
      <h2 className="mb-2 font-semibold text-slate-800">Gmail返信下書き</h2>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="text-slate-500" htmlFor={`from-${inquiryId}`}>
          送信元
        </label>
        <select
          id={`from-${inquiryId}`}
          className="min-w-[12rem] rounded border border-slate-300 px-2 py-1"
          value={from}
          disabled={pending || loadingAliases || aliases.length === 0}
          onChange={(e) => setFrom(e.target.value)}
        >
          {aliases.map((a) => (
            <option key={a} value={a}>
              {a}
              {primary && a === primary ? "（primary）" : ""}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="rounded border border-slate-800 bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700 disabled:opacity-50"
        disabled={pending || !from || loadingAliases}
        onClick={() => {
          setError(null);
          setMessage(null);
          const requestId = `${requestBase}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          start(async () => {
            const r = await createInquiryReplyDraftAction({
              inquiryId,
              fromAddress: from,
              requestId,
            });
            if (!r.ok) {
              setError(r.message);
              setDone(false);
              return;
            }
            setDone(true);
            setMessage(r.message || "Gmailに返信下書きを作成しました");
          });
        }}
      >
        {pending ? "作成中…" : "Gmail返信下書きを作成"}
      </button>
      {error ? (
        <p className="mt-2 text-red-600">{error}</p>
      ) : null}
      {done && message ? (
        <div className="mt-2 space-y-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-900">
          <p>{message}</p>
          <a
            href="https://mail.google.com/mail/#drafts"
            target="_blank"
            rel="noreferrer"
            className="inline-block underline"
          >
            Gmailの下書きを開く
          </a>
        </div>
      ) : null}
      <p className="mt-2 text-slate-500">
        下書き作成のみ行います。送信は Gmail 上で人間が行ってください。
      </p>
    </section>
  );
}

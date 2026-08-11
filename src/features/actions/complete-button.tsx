"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { completeActionAction } from "@/features/actions/actions";

export function CompleteActionButton({
  notionPageId,
  externalId,
  lastEditedTime,
  compact,
}: {
  notionPageId: string;
  externalId: string;
  lastEditedTime: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [completed, setCompleted] = useState(false);
  const submittingRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    setConflict(false);
    setCompleted(false);
    try {
      const result = await completeActionAction({
        requestId,
        notionPageId,
        externalId,
        expectedLastEditedTime: lastEditedTime,
      });
      setBusy(false);
      if (result.ok) {
        setCompleted(true);
        refreshTimerRef.current = window.setTimeout(
          () => router.refresh(),
          1_200,
        );
        return;
      }
      submittingRef.current = false;
      if (result.reason === "conflict") {
        setConflict(true);
        return;
      }
      setError(result.message);
      if (
        result.reason === "notion_failed" ||
        result.reason === "input_hash_mismatch" ||
        result.reason === "unknown" ||
        result.reason === "no_page"
      ) {
        setRequestId(crypto.randomUUID());
      }
    } catch {
      submittingRef.current = false;
      setBusy(false);
      setError("完了にできませんでした。通信状態を確認して、もう一度お試しください。");
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || conflict || completed}
        className={
          compact
            ? "rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
            : "rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {completed ? "完了にしました" : busy ? "完了中..." : "完了"}
      </button>
      {completed && (
        <span className="text-[10px] font-medium text-emerald-700" role="status">
          次回アクションを完了にしました
        </span>
      )}
      {conflict && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[10px] text-amber-700 underline"
        >
          別の更新が反映されています。表示を更新
        </button>
      )}
      {error && (
        <span
          className="max-w-40 text-[10px] text-red-600"
          role="alert"
        >
          {error}
        </span>
      )}
    </span>
  );
}

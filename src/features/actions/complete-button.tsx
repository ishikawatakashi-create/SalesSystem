"use client";

import { useState } from "react";
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

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    setConflict(false);
    const result = await completeActionAction({
      requestId,
      notionPageId,
      externalId,
      expectedLastEditedTime: lastEditedTime,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
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
  };

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || conflict}
        className={
          compact
            ? "rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
            : "rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {busy ? "完了中..." : "完了"}
      </button>
      {conflict && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[10px] text-amber-700 underline"
        >
          競合: 再読込
        </button>
      )}
      {error && (
        <span className="max-w-40 text-[10px] text-red-600">{error}</span>
      )}
    </span>
  );
}

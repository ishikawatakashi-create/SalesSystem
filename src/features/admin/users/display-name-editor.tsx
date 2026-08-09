"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateDisplayNameAction } from "@/features/admin/users/actions";

export function DisplayNameEditor(props: {
  targetUserId: string;
  initialName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const composing = useRef(false);

  if (!props.canEdit) {
    return <span>{props.initialName}</span>;
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{props.initialName}</span>
        <button
          type="button"
          className="text-[11px] text-slate-500 underline hover:text-slate-800"
          onClick={() => {
            setDraft(props.initialName);
            setError(null);
            setEditing(true);
          }}
        >
          編集
        </button>
      </span>
    );
  }

  function cancel() {
    setDraft(props.initialName);
    setError(null);
    setEditing(false);
  }

  function save() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateDisplayNameAction({
        targetUserId: props.targetUserId,
        displayName: draft,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-1">
        <input
          type="text"
          value={draft}
          disabled={pending}
          autoFocus
          maxLength={100}
          className="min-w-[8rem] rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded bg-slate-800 px-2 py-1 text-[11px] text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50"
        >
          取消
        </button>
      </span>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}

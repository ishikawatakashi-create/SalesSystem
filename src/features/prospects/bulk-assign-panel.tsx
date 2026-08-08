"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bulkAssignProspectsAction } from "@/features/prospects/actions";

export function BulkAssignPanel({
  listId,
  membershipIds,
  assignees,
}: {
  listId: string;
  membershipIds: string[];
  assignees: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"single" | "equal">("equal");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <p className="mb-1 font-medium text-slate-700">一括割当（表示中の行）</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          multiple
          className="min-h-[4rem] min-w-[10rem] rounded border border-slate-200 bg-white px-1"
          value={selected}
          onChange={(e) =>
            setSelected(
              Array.from(e.target.selectedOptions).map((o) => o.value),
            )
          }
        >
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "single"}
            onChange={() => setMode("single")}
          />
          単一担当
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "equal"}
            onChange={() => setMode("equal")}
          />
          均等割当
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
          />
          未割当のみ（既定）
        </label>
        <button
          type="button"
          disabled={pending || selected.length === 0 || membershipIds.length === 0}
          className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-40"
          onClick={() => {
            setMessage(null);
            start(async () => {
              const res = await bulkAssignProspectsAction({
                listId,
                membershipIds,
                assigneeUserIds: selected,
                mode,
                onlyUnassigned,
                overwrite: !onlyUnassigned,
              });
              if (!res.ok) {
                setMessage(res.error);
                return;
              }
              setMessage(
                res.updated > 0 || res.skipped > 0
                  ? `更新 ${res.updated} / スキップ ${res.skipped}`
                  : "ジョブを投入しました",
              );
              router.refresh();
            });
          }}
        >
          実行
        </button>
      </div>
      {message ? <p className="mt-1 text-slate-600">{message}</p> : null}
    </div>
  );
}

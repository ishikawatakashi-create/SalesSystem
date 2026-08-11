"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

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
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const submittingRef = useRef(false);

  return (
    <div
      className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
      aria-busy={pending}
    >
      <p className="mb-1 font-medium text-slate-700">
        自社担当者を一括割当（表示中の行）
      </p>
      <p className="mb-1.5 text-[11px] text-slate-600">
        対象: 表示中の{" "}
        <span className="font-semibold text-slate-800">
          {membershipIds.length}件
        </span>
        （一覧の全件ではありません）
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={
            mode === "single"
              ? "割り当てる自社担当者（1人）"
              : "均等に割り当てる自社担当者（複数選択可）"
          }
          multiple={mode === "equal"}
          disabled={pending}
          className={`${
            mode === "equal" ? "min-h-[4rem]" : "h-7"
          } min-w-[10rem] rounded border border-slate-200 bg-white px-1 disabled:bg-slate-100`}
          value={mode === "single" ? (selected[0] ?? "") : selected}
          onChange={(e) => {
            const values = Array.from(e.target.selectedOptions)
              .map((option) => option.value)
              .filter(Boolean);
            setSelected(mode === "single" ? values.slice(0, 1) : values);
          }}
        >
          {mode === "single" ? (
            <option value="">自社担当者を選択</option>
          ) : null}
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">割当方法</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="bulk-assignment-mode"
              checked={mode === "single"}
              disabled={pending}
              onChange={() => {
                setMode("single");
                setSelected((current) => current.slice(0, 1));
              }}
            />
            1人にまとめて割当
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="bulk-assignment-mode"
              checked={mode === "equal"}
              disabled={pending}
              onChange={() => setMode("equal")}
            />
            選択した自社担当者へ均等割当
          </label>
        </fieldset>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            disabled={pending}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
          />
          未割当のみ（既定）
        </label>
        <button
          type="button"
          disabled={
            pending ||
            selected.length === 0 ||
            (mode === "single" && selected.length !== 1) ||
            membershipIds.length === 0
          }
          className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-40"
          onClick={() => {
            if (submittingRef.current) return;
            if (
              !onlyUnassigned &&
              !window.confirm(
                `表示中の最大${membershipIds.length}件について、既存の自社担当者も上書きします。実行しますか？`,
              )
            ) {
              return;
            }
            submittingRef.current = true;
            setFeedback(null);
            start(async () => {
              try {
                const res = await bulkAssignProspectsAction({
                  listId,
                  membershipIds,
                  assigneeUserIds: selected,
                  mode,
                  onlyUnassigned,
                  overwrite: !onlyUnassigned,
                });
                if (!res.ok) {
                  setFeedback({ tone: "error", message: res.error });
                  return;
                }
                setFeedback({
                  tone: "success",
                  message:
                    res.updated > 0 || res.skipped > 0
                      ? `割当済み ${res.updated}件 / 変更なし ${res.skipped}件`
                      : "一括割当を受け付けました",
                });
                router.refresh();
              } catch {
                setFeedback({
                  tone: "error",
                  message:
                    "一括割当を実行できませんでした。通信状態を確認して、もう一度お試しください。",
                });
              } finally {
                submittingRef.current = false;
              }
            });
          }}
        >
          {pending
            ? "割当処理中…"
            : onlyUnassigned
              ? "一括割当を実行"
              : "既存担当者を上書きして実行"}
        </button>
      </div>
      {!onlyUnassigned ? (
        <p
          role="alert"
          className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
        >
          既に割り当てられている自社担当者も変更します。実行前に確認画面を表示します。
        </p>
      ) : null}
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`mt-1 ${
            feedback.tone === "error" ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

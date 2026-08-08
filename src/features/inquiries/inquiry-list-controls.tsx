"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  assignInquiryAction,
  setInquiryStatusAction,
} from "@/features/inquiries/actions";
import {
  INQUIRY_STATUS_LABELS,
  NO_ACTION_REASON_SUGGESTIONS,
  type InquiryStatus,
} from "@/lib/inquiries/types";

const STATUSES: InquiryStatus[] = [
  "new",
  "in_progress",
  "done",
  "no_action",
];

export function InquiryListControls({
  inquiryId,
  assignedUserId,
  status,
  canEdit,
  assignees,
}: {
  inquiryId: string;
  assignedUserId: string | null;
  status: InquiryStatus;
  canEdit: boolean;
  assignees: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [assignee, setAssignee] = useState(assignedUserId ?? "");
  const [currentStatus, setCurrentStatus] = useState<InquiryStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [noActionOpen, setNoActionOpen] = useState(false);
  const [noActionReason, setNoActionReason] = useState("");

  if (!canEdit) {
    return (
      <>
        <td className="px-2 py-1.5">
          {assignee
            ? assignees.find((a) => a.id === assignee)?.label || "—"
            : "未割当"}
        </td>
        <td className="px-2 py-1.5">
          {INQUIRY_STATUS_LABELS[currentStatus]}
        </td>
      </>
    );
  }

  return (
    <>
      <td className="px-2 py-1.5">
        <select
          className="max-w-[9rem] rounded border border-slate-300 bg-white px-1 py-0.5 disabled:opacity-60"
          value={assignee}
          disabled={pending}
          aria-label="担当者"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const prev = assignee;
            const next = e.target.value;
            setAssignee(next);
            setError(null);
            start(async () => {
              const r = await assignInquiryAction({
                inquiryId,
                userId: next || null,
              });
              if (!r.ok) {
                setAssignee(prev);
                setError(r.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          <option value="">未割当</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {pending ? (
          <span className="ml-1 text-[10px] text-slate-400">保存中</span>
        ) : null}
      </td>
      <td className="relative px-2 py-1.5">
        <select
          className="max-w-[7rem] rounded border border-slate-300 bg-white px-1 py-0.5 disabled:opacity-60"
          value={currentStatus}
          disabled={pending}
          aria-label="状態"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = e.target.value as InquiryStatus;
            if (next === "no_action") {
              setNoActionOpen(true);
              return;
            }
            const prev = currentStatus;
            setCurrentStatus(next);
            setError(null);
            start(async () => {
              const r = await setInquiryStatusAction({
                inquiryId,
                status: next,
              });
              if (!r.ok) {
                setCurrentStatus(prev);
                setError(r.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {error ? (
          <div className="mt-0.5 text-[10px] text-red-600">{error}</div>
        ) : null}

        {noActionOpen ? (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="対応不要の理由"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-sm rounded border border-slate-200 bg-white p-3 text-xs shadow">
              <p className="mb-2 font-semibold text-slate-800">
                対応不要にする理由
              </p>
              <input
                className="mb-2 w-full rounded border border-slate-300 px-2 py-1"
                list={`no-action-reasons-${inquiryId}`}
                value={noActionReason}
                onChange={(e) => setNoActionReason(e.target.value)}
                placeholder="理由を入力"
              />
              <datalist id={`no-action-reasons-${inquiryId}`}>
                {NO_ACTION_REASON_SUGGESTIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1"
                  onClick={() => {
                    setNoActionOpen(false);
                    setNoActionReason("");
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-800 bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
                  disabled={pending || !noActionReason.trim()}
                  onClick={() => {
                    const prev = currentStatus;
                    setCurrentStatus("no_action");
                    setNoActionOpen(false);
                    start(async () => {
                      const r = await setInquiryStatusAction({
                        inquiryId,
                        status: "no_action",
                        noActionReason: noActionReason.trim(),
                      });
                      if (!r.ok) {
                        setCurrentStatus(prev);
                        setError(r.message);
                      } else {
                        router.refresh();
                      }
                      setNoActionReason("");
                    });
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </td>
    </>
  );
}

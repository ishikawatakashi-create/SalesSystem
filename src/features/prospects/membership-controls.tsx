"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  setProspectAssigneeAction,
  setProspectStageAction,
} from "@/features/prospects/actions";
import {
  MANUAL_PROSPECT_MEMBERSHIP_STAGES,
  PROSPECT_STAGE_LABELS,
  type ProspectMembershipStage,
} from "@/lib/prospects/types";

export function MembershipControls({
  membershipId,
  listId,
  stage,
  assignedUserId,
  assignees,
  canEdit,
}: {
  membershipId: string;
  listId: string;
  stage: ProspectMembershipStage;
  assignedUserId: string | null;
  assignees: Array<{ id: string; label: string; disabled?: boolean }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localStage, setLocalStage] = useState(stage);
  const [localAssignee, setLocalAssignee] = useState(assignedUserId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!canEdit) {
    const assigneeLabel =
      assignees.find((a) => a.id === assignedUserId)?.label ?? "未割当";
    return (
      <span className="text-slate-600">
        {PROSPECT_STAGE_LABELS[stage]} / {assigneeLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        {stage === "converted" ? (
          <span className="max-w-[7rem] px-1 py-0.5 text-xs text-slate-600">
            {PROSPECT_STAGE_LABELS.converted}
          </span>
        ) : (
          <select
            aria-label="対応状況"
            className="max-w-[7rem] rounded border border-slate-200 px-1 py-0.5 text-xs"
            value={localStage}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value as ProspectMembershipStage;
              const prev = localStage;
              setLocalStage(next);
              setError(null);
              setSuccess(null);
              start(async () => {
                const res = await setProspectStageAction({
                  membershipId,
                  stage: next,
                  listId,
                });
                if (!res.ok) {
                  setLocalStage(prev);
                  setError(res.error);
                  return;
                }
                setSuccess("対応状況を更新しました");
                router.refresh();
              });
            }}
          >
            {MANUAL_PROSPECT_MEMBERSHIP_STAGES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="自社担当者"
          className="max-w-[8rem] rounded border border-slate-200 px-1 py-0.5 text-xs"
          value={localAssignee}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            const prev = localAssignee;
            setLocalAssignee(next);
            setError(null);
            setSuccess(null);
            start(async () => {
              const res = await setProspectAssigneeAction({
                membershipId,
                assignedUserId: next || null,
                listId,
              });
              if (!res.ok) {
                setLocalAssignee(prev);
                setError(res.error);
                return;
              }
              setSuccess("自社担当者を更新しました");
              router.refresh();
            });
          }}
        >
          <option value="">未割当</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id} disabled={a.disabled}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="text-[10px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-[10px] text-emerald-700">
          {success}
        </p>
      ) : null}
    </div>
  );
}

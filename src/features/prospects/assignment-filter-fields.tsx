"use client";

import { useState } from "react";

export function AssignmentFilterFields({
  assignees,
  initialAssignedUserId,
  initialUnassignedOnly,
}: {
  assignees: Array<{ id: string; label: string }>;
  initialAssignedUserId: string | null;
  initialUnassignedOnly: boolean;
}) {
  const [assignedUserId, setAssignedUserId] = useState(
    initialUnassignedOnly ? "" : (initialAssignedUserId ?? ""),
  );
  const [unassignedOnly, setUnassignedOnly] = useState(initialUnassignedOnly);

  return (
    <>
      <select
        name="assigned"
        aria-label="自社担当者"
        value={assignedUserId}
        disabled={unassignedOnly}
        onChange={(event) => {
          setAssignedUserId(event.target.value);
          if (event.target.value) setUnassignedOnly(false);
        }}
        className="rounded border border-slate-200 px-1 py-1 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">すべての自社担当者</option>
        {assignees.map((assignee) => (
          <option key={assignee.id} value={assignee.id}>
            {assignee.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          name="unassigned"
          value="1"
          checked={unassignedOnly}
          onChange={(event) => {
            const checked = event.target.checked;
            setUnassignedOnly(checked);
            if (checked) setAssignedUserId("");
          }}
        />
        未割当のみ
      </label>
    </>
  );
}

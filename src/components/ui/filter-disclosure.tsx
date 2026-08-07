"use client";

import { useMemo, useState } from "react";

/** 詳細条件の折りたたみ。適用中件数を表示 */
export function FilterDisclosure({
  appliedCount,
  children,
  defaultOpen = false,
}: {
  appliedCount: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || appliedCount > 0);
  const label = useMemo(() => {
    if (appliedCount > 0) return `詳細条件（${appliedCount}件適用中）`;
    return "詳細条件";
  }, [appliedCount]);

  return (
    <div className="w-full">
      <button
        type="button"
        className="text-xs text-slate-600 underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▼ " : "▶ "}
        {label}
      </button>
      {open && <div className="mt-2 flex flex-wrap items-end gap-2">{children}</div>}
    </div>
  );
}

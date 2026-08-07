"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { FilterDisclosure } from "@/components/ui/filter-disclosure";

const TABS = [
  { id: "open", label: "未確認+対応中" },
  { id: "new", label: "未確認" },
  { id: "in_progress", label: "対応中" },
  { id: "done", label: "対応済" },
  { id: "no_action", label: "対応不要" },
  { id: "all", label: "すべて" },
] as const;

export function InquiryToolbar({
  assignees,
}: {
  assignees: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [assigned, setAssigned] = useState(sp.get("assigned") ?? "");
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const tab = sp.get("tab") || "open";

  const detailCount = [from, to, status].filter(Boolean).length;

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/inquiries?${params.toString()}`);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1 text-xs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => apply({ tab: t.id })}
            className={
              tab === t.id
                ? "border-b-2 border-slate-800 px-2 py-1 font-semibold text-slate-900"
                : "border-b-2 border-transparent px-2 py-1 text-slate-600 hover:text-slate-900"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q, assigned, from, to, status });
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">フリーワード</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
            placeholder="名前・会社・メール…"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-slate-500">担当</span>
          <select
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">すべて</option>
            <option value="__unassigned__">未割当</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover"
        >
          絞り込み
        </button>
      </form>
      <FilterDisclosure
        appliedCount={detailCount}
        defaultOpen={detailCount > 0}
      >
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-500">受信日 From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-500">受信日 To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-500">状態（上書き）</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">タブに従う</option>
              <option value="new">未確認</option>
              <option value="in_progress">対応中</option>
              <option value="done">対応済</option>
              <option value="no_action">対応不要</option>
            </select>
          </label>
          <button
            type="button"
            className="self-end rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            onClick={() => apply({ q, assigned, from, to, status })}
          >
            詳細条件を適用
          </button>
        </div>
      </FilterDisclosure>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { bulkCreateActivitiesAction } from "@/features/activities/actions";
import { fromDatetimeLocalValue } from "@/features/activities/format";
import type { ActivityFormOptions } from "@/features/activities/options";

export function ActivityBulkForm({
  options,
  initialCustomerIds,
}: {
  options: ActivityFormOptions;
  initialCustomerIds?: string[];
}) {
  const router = useRouter();
  const [batchRequestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [activityAt, setActivityAt] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
  });
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialCustomerIds ?? []),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<
    { rowId: string; ok: boolean; message?: string }[] | null
  >(null);

  const customers = options.customers.filter((c) => !c.isArchived);

  const selectedNames = useMemo(
    () =>
      customers
        .filter((c) => selected.has(c.pageId))
        .map((c) => c.displayName),
    [customers, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (id: string) => {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const onSubmit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("タイトルは必須です");
      return;
    }
    if (selected.size === 0) {
      setError("顧客を1件以上選択してください");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setBusy(true);
    const result = await bulkCreateActivitiesAction({
      batchRequestId,
      common: {
        title: title.trim(),
        activityAt: fromDatetimeLocalValue(activityAt),
        categoryPageIds: categoryIds,
        summary: summary.trim() || null,
        body,
      },
      customerPageIds: [...selected],
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      setConfirming(false);
      return;
    }
    setResults(result.rows);
  };

  if (results) {
    const okCount = results.filter((r) => r.ok).length;
    const ngCount = results.length - okCount;
    return (
      <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-xs">
        <p className="font-medium">
          一括登録結果: 成功 {okCount}件 / 失敗 {ngCount}件
        </p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((r) => {
            const name =
              customers.find((c) => c.pageId === r.rowId)?.displayName ??
              "顧客";
            return (
              <li
                key={r.rowId}
                className={r.ok ? "text-slate-700" : "text-red-700"}
              >
                {name}: {r.ok ? "成功" : (r.message ?? "失敗")}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/activities")}
            className="rounded bg-primary px-3 py-1.5 text-white hover:bg-primary-hover"
          >
            一覧へ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {confirming ? (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">
            {selected.size}件の顧客へ対応履歴を登録します。よろしいですか？
          </p>
          <ul className="max-h-40 list-inside list-disc overflow-y-auto">
            {selectedNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onSubmit}
              className="rounded bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "登録中..." : "確定して登録"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              戻る
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-600">
                タイトル<span className="ml-0.5 text-red-600">*</span>
              </span>
              <input
                className="h-7 rounded border border-slate-300 px-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-600">
                対応日時<span className="ml-0.5 text-red-600">*</span>
              </span>
              <input
                type="datetime-local"
                className="h-7 rounded border border-slate-300 px-2"
                value={activityAt}
                onChange={(e) => setActivityAt(e.target.value)}
              />
            </label>
            <div className="text-xs">
              <span className="text-slate-600">対応分類</span>
              <div className="mt-1 flex max-h-28 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded border border-slate-200 p-2">
                {options.categories.map((c) => (
                  <label key={c.pageId} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.pageId)}
                      onChange={() => toggleCategory(c.pageId)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-600">要約</span>
              <input
                className="h-7 rounded border border-slate-300 px-2"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-slate-600">本文</span>
              <textarea
                className="min-h-24 rounded border border-slate-300 px-2 py-1.5"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          </div>

          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="font-medium text-slate-700">対象顧客</span>
              <span className="text-slate-500">{selected.size}件選択</span>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {customers.map((c) => (
                <label
                  key={c.pageId}
                  className="flex items-center gap-2 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.pageId)}
                    onChange={() => toggle(c.pageId)}
                  />
                  {c.displayName}
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onSubmit}
            className="rounded bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            確認へ進む
          </button>
        </>
      )}
    </div>
  );
}

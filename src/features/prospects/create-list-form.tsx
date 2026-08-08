"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createProspectListAction } from "@/features/prospects/actions";
import {
  PROSPECT_SOURCE_TYPES,
  type ProspectSourceType,
} from "@/lib/prospects/types";

export function CreateProspectListForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded border border-slate-200 bg-white p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await createProspectListAction({
            name: String(fd.get("name") ?? ""),
            description: String(fd.get("description") ?? "") || undefined,
            sourceType: (String(fd.get("sourceType") ?? "csv") ||
              "csv") as ProspectSourceType,
            sourceName: String(fd.get("sourceName") ?? "") || undefined,
          });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          router.push(`/prospect-lists/${res.id}`);
        });
      }}
    >
      {error ? <p className="text-red-600">{error}</p> : null}
      <label className="block space-y-1">
        <span className="text-slate-600">リスト名 *</span>
        <input
          name="name"
          required
          className="w-full rounded border border-slate-200 px-2 py-1"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-slate-600">説明</span>
        <textarea
          name="description"
          rows={2}
          className="w-full rounded border border-slate-200 px-2 py-1"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-slate-600">source_type</span>
        <select
          name="sourceType"
          defaultValue="csv"
          className="w-full rounded border border-slate-200 px-2 py-1"
        >
          {PROSPECT_SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-slate-600">source_name</span>
        <input
          name="sourceName"
          className="w-full rounded border border-slate-200 px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-50"
      >
        作成
      </button>
    </form>
  );
}

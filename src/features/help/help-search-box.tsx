"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { searchHelpContent } from "@/lib/help/search";
import type { HelpSearchHit } from "@/lib/help/search";

function hitHref(hit: HelpSearchHit): string {
  if (hit.kind === "article") return `/help/${hit.item.slug}`;
  if (hit.kind === "faq") return `/help/faq#${hit.item.id}`;
  return `/help/terminology#${hit.item.id}`;
}

function hitTitle(hit: HelpSearchHit): string {
  if (hit.kind === "article") return hit.item.title;
  if (hit.kind === "faq") return hit.item.question;
  return hit.item.term;
}

function hitKindLabel(hit: HelpSearchHit): string {
  if (hit.kind === "article") return "記事";
  if (hit.kind === "faq") return "FAQ";
  return "用語";
}

export function HelpSearchBox({
  includeAdmin = false,
  initialQuery = "",
}: {
  includeAdmin?: boolean;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const hits = useMemo(
    () => searchHelpContent(q, { includeAdmin, limit: 12 }),
    [q, includeAdmin],
  );

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-600">
        やりたいことを検索
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="例: 電話 / アポ / 顧客登録 / 問い合わせ"
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          aria-label="ヘルプを検索"
        />
      </label>

      {q.trim() && hits.length === 0 && (
        <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <p className="font-medium text-slate-800">
            該当するヘルプが見つかりませんでした
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>用語を短くして再検索する（例: 「電話」「アポ」）</li>
            <li>
              <Link href="/help#common" className="text-slate-900 underline">
                よくある操作
              </Link>
              を見る
            </li>
            <li>
              <Link href="/help/manual" className="text-slate-900 underline">
                完全マニュアル
              </Link>
              を見る
            </li>
          </ul>
        </div>
      )}

      {hits.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
          {hits.map((hit) => (
            <li key={`${hit.kind}-${hitHref(hit)}`}>
              <Link
                href={hitHref(hit)}
                className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50"
              >
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {hitKindLabel(hit)}
                </span>
                <span className="font-medium text-slate-900">
                  {hitTitle(hit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

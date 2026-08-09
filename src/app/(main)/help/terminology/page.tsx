import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { HELP_TERMS, getHelpTerm } from "@/lib/help/terminology";

export default function HelpTerminologyPage() {
  return (
    <div className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "ヘルプ", href: "/help" },
          { label: "用語集" },
        ]}
      />
      <h1 className="mt-2 text-base font-bold text-slate-900">用語集</h1>
      <p className="mt-1 text-xs text-slate-600">
        特に混同しやすい言葉を整理しています。内部コード名はできるだけ使いません。
      </p>

      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <p className="font-semibold text-slate-900">担当者は3種類あります</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
{`株式会社さくらケア
  先方担当者 …… 山田様（相手会社の人）
  自社担当者 …… 石川（うちの社員）
  石川の権限 …… 担当者（ログイン役割）`}
        </pre>
      </div>

      <ul className="mt-4 space-y-3">
        {HELP_TERMS.map((term) => (
          <li
            key={term.id}
            id={term.id}
            className="scroll-mt-4 rounded border border-slate-200 bg-white p-3 text-xs"
          >
            <h2 className="font-semibold text-slate-900">{term.term}</h2>
            <p className="mt-0.5 text-slate-700">{term.short}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-600">
              {term.detail.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            {term.related && term.related.length > 0 && (
              <p className="mt-2 text-slate-500">
                関連用語:{" "}
                {term.related.map((id, i) => {
                  const t = getHelpTerm(id);
                  if (!t) return null;
                  return (
                    <span key={id}>
                      {i > 0 ? " / " : ""}
                      <a href={`#${id}`} className="underline">
                        {t.term}
                      </a>
                    </span>
                  );
                })}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs">
        <Link href="/help" className="underline">
          ← Helpトップ
        </Link>
      </p>
    </div>
  );
}

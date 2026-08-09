import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { HelpArticle } from "@/lib/help/types";
import { getHelpCategory } from "@/lib/help/categories";
import { getHelpArticle } from "@/lib/help/articles";

export function HelpArticleView({ article }: { article: HelpArticle }) {
  const category = getHelpCategory(article.category);
  const related = article.related
    .map((slug) => getHelpArticle(slug))
    .filter((a): a is HelpArticle => Boolean(a));

  return (
    <article className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "ヘルプ", href: "/help" },
          ...(category
            ? [{ label: category.label, href: `/help?category=${category.id}` }]
            : []),
          { label: article.title },
        ]}
      />

      <h1 className="mt-2 text-base font-bold text-slate-900">{article.title}</h1>
      <p className="mt-1 text-xs text-slate-600">{article.summary}</p>

      {article.steps && article.steps.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-slate-800">手順</h2>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-4 text-xs text-slate-800">
            {article.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {article.body && article.body.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-slate-800">ポイント</h2>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs text-slate-800">
            {article.body.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {article.tips && article.tips.length > 0 && (
        <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <h2 className="text-sm font-semibold text-slate-800">ヒント</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-slate-700">
            {article.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-5 border-t border-slate-200 pt-3">
          <h2 className="text-sm font-semibold text-slate-800">関連する記事</h2>
          <ul className="mt-1.5 space-y-1 text-xs">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/help/${r.slug}`} className="underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-xs">
        <Link href="/help" className="text-slate-600 underline">
          ← Helpトップ
        </Link>
      </p>
    </article>
  );
}

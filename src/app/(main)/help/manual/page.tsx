import Link from "next/link";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { listHelpArticles } from "@/lib/help/articles";
import { HELP_CATEGORIES } from "@/lib/help/categories";

/**
 * アプリ内の「操作ガイド一覧」ページ。
 * やりたいことやカテゴリから、各操作記事へ辿れるようにする。
 */
export default function HelpManualPage() {
  const articles = listHelpArticles({ includeAdmin: true });

  return (
    <div className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "ヘルプ", href: "/help" },
          { label: "操作ガイド一覧" },
        ]}
      />
      <h1 className="mt-2 text-base font-bold text-slate-900">
        SalesSystem 操作ガイド一覧
      </h1>
      <p className="mt-1 text-xs text-slate-600">
        やりたい操作を下の一覧から選んでください。各記事で手順と注意点を確認できます。
      </p>

      <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
        <h2 className="font-semibold text-slate-800">やりたいことから探す</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {(
            [
              ["今日やることを確認したい", "/help/mydesk"],
              ["会社を探したい", "/help/search-company"],
              ["顧客を登録したい", "/help/create-organization"],
              ["新しい営業先を大量に登録したい", "/help/import-prospect-csv"],
              ["Web問い合わせを処理したい", "/help/handle-inquiry"],
              ["電話営業したい", "/help/call-prospect"],
              ["明日もう一度電話したい", "/help/recalls"],
              ["アポが取れた", "/help/promote-prospect"],
              ["商談管理したい", "/help/create-deal"],
              ["何を話したか残したい", "/help/create-activity"],
              ["忘れたくない予定を入れたい", "/help/create-action"],
              ["重大トラブルを管理したい", "/help/create-complaint"],
              ["営業連絡不要と言われた", "/help/do-not-contact"],
              ["見込顧客と営業候補の違い", "/help/prospect-vs-organization"],
              ["担当者の意味が分からない", "/help/three-assignees"],
              ["請求書はどこ？", "/help/create-contract"],
            ] as const
          ).map(([label, href]) => (
            <li key={href}>
              <Link href={href} className="underline">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {HELP_CATEGORIES.filter((c) => !c.adminOnly).map((cat) => {
        const items = articles.filter((a) => a.category === cat.id);
        if (items.length === 0) return null;
        return (
          <section key={cat.id} className="mt-5">
            <h2 className="text-sm font-semibold text-slate-800">{cat.label}</h2>
            <p className="text-[11px] text-slate-500">{cat.description}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">
              {items.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="mt-6 text-xs">
        <Link href="/help" className="underline">
          ← Helpトップ
        </Link>
        {" · "}
        <Link href="/help/faq" className="underline">
          FAQ
        </Link>
        {" · "}
        <Link href="/help/terminology" className="underline">
          用語集
        </Link>
      </p>
    </div>
  );
}

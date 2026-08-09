import Link from "next/link";

import { HelpArticleView } from "@/features/help/help-article-view";
import { getHelpArticle } from "@/lib/help/articles";
import { notFound } from "next/navigation";

/** はじめてガイド（記事 quick-start の専用入口） */
export default function HelpQuickStartPage() {
  const article = getHelpArticle("quick-start");
  if (!article) notFound();

  return (
    <div>
      <HelpArticleView article={article} />
      <div className="mt-4 max-w-3xl space-y-2 text-xs">
        <p className="font-medium text-slate-800">あわせて読む</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <Link href="/help/where-to-register" className="underline">
              どこに登録する？（早見表）
            </Link>
          </li>
          <li>
            <Link href="/help/three-flows" className="underline">
              3つの基本フロー
            </Link>
          </li>
          <li>
            <Link href="/help/manual" className="underline">
              完全マニュアル（詳細）
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

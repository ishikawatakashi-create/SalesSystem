import Link from "next/link";

import { HelpSearchBox } from "@/features/help/help-search-box";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { HELP_CATEGORIES } from "@/lib/help/categories";
import { listFeaturedArticles, listHelpArticles } from "@/lib/help/articles";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TOP_LINKS = [
  { href: "/help/quick-start", label: "はじめて使う方" },
  { href: "/help#common", label: "よくある操作" },
  { href: "/help/terminology", label: "用語集" },
  { href: "/help#categories", label: "画面別・カテゴリ" },
  { href: "/help/manual", label: "完全マニュアル" },
] as const;

export default async function HelpTopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let includeAdmin = false;
  try {
    const user = await requireUser();
    includeAdmin = hasPermission(user.role, "user.manage");
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated") {
      redirect("/login");
    }
    throw e;
  }

  const params = await searchParams;
  const categoryRaw = params.category;
  const category =
    typeof categoryRaw === "string" && categoryRaw.trim()
      ? categoryRaw.trim()
      : null;

  const categories = HELP_CATEGORIES.filter(
    (c) => includeAdmin || !c.adminOnly,
  );
  const featured = listFeaturedArticles(includeAdmin);
  const articles = listHelpArticles({
    includeAdmin,
    category: category ?? undefined,
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-base font-bold text-slate-900">SalesSystem ヘルプ</h1>
      <p className="mt-1 text-xs text-slate-600">
        困ったときだけ開く使い方ガイドです。業務画面の密度はそのまま、必要なときだけ深く読めます。
      </p>

      <nav
        aria-label="ヘルプの入り口"
        className="mt-3 flex flex-wrap gap-2 text-xs"
      >
        {TOP_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
          >
            {link.label}
          </Link>
        ))}
        <Link
          href="/help/faq"
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
        >
          FAQ
        </Link>
      </nav>

      <div className="mt-4">
        <HelpSearchBox includeAdmin={includeAdmin} />
      </div>

      <section id="common" className="mt-6 scroll-mt-4">
        <h2 className="text-sm font-semibold text-slate-800">よく使う項目</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {featured.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/help/${a.slug}`}
                className="block rounded border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{a.title}</span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {a.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="categories" className="mt-6 scroll-mt-4">
        <h2 className="text-sm font-semibold text-slate-800">カテゴリ</h2>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/help"
            className={`rounded border px-2 py-1 ${
              !category
                ? "border-slate-700 bg-slate-700 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            すべて
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/help?category=${c.id}`}
              className={`rounded border px-2 py-1 ${
                category === c.id
                  ? "border-slate-700 bg-slate-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {c.label}
              {c.adminOnly ? "（管理者）" : ""}
            </Link>
          ))}
        </div>

        <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/help/${a.slug}`}
                className="flex flex-col px-3 py-2 hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{a.title}</span>
                <span className="text-[11px] text-slate-500">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

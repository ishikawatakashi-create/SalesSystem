import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getHelpArticle } from "@/lib/help/articles";
import { listHelpFaqs } from "@/lib/help/faq";
import { getHelpCategory } from "@/lib/help/categories";

export const dynamic = "force-dynamic";

export default async function HelpFaqPage() {
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

  const faqs = listHelpFaqs(includeAdmin);

  return (
    <div className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "ヘルプ", href: "/help" },
          { label: "FAQ" },
        ]}
      />
      <h1 className="mt-2 text-base font-bold text-slate-900">よくある質問</h1>
      <p className="mt-1 text-xs text-slate-600">
        「やりたいこと」から探すQ&Aです。詳細手順は関連記事へ進めます。
      </p>

      <ul className="mt-4 space-y-3">
        {faqs.map((faq) => {
          const cat = getHelpCategory(faq.category);
          return (
            <li
              key={faq.id}
              id={faq.id}
              className="scroll-mt-4 rounded border border-slate-200 bg-white p-3 text-xs"
            >
              <p className="text-[10px] text-slate-500">{cat?.label}</p>
              <h2 className="mt-0.5 font-semibold text-slate-900">
                Q. {faq.question}
              </h2>
              <div className="mt-1.5 space-y-1 text-slate-700">
                {faq.answer.map((line, idx) => (
                  <p key={line}>
                    {idx === 0 ? "A. " : ""}
                    {line}
                  </p>
                ))}
              </div>
              {faq.related && faq.related.length > 0 && (
                <p className="mt-2 text-slate-600">
                  関連:{" "}
                  {faq.related.map((slug, i) => {
                    const a = getHelpArticle(slug);
                    if (!a) return null;
                    return (
                      <span key={slug}>
                        {i > 0 ? " / " : ""}
                        <Link href={`/help/${slug}`} className="underline">
                          {a.title}
                        </Link>
                      </span>
                    );
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs">
        <Link href="/help" className="underline">
          ← Helpトップ
        </Link>
      </p>
    </div>
  );
}

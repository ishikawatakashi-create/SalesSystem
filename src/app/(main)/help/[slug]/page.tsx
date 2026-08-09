import { notFound, redirect } from "next/navigation";

import { HelpArticleView } from "@/features/help/help-article-view";
import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { getHelpArticle } from "@/lib/help/articles";

export const dynamic = "force-dynamic";

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();

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

  if (article.category === "admin" && !includeAdmin) {
    notFound();
  }

  return <HelpArticleView article={article} />;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import type { AppUserRow } from "@/types/database";

const ROLE_LABELS: Record<AppUserRow["role"], string> = {
  admin: "管理者",
  a: "営業A",
  b: "営業B",
  viewer: "閲覧",
};

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let user: AppUserRow;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated") {
      redirect("/login");
    }
    if (e instanceof AuthError) {
      // セッションはあるが利用不可(未招待・無効化・準備未完了)→ サインアウトさせる
      redirect(`/auth/signout?error=${e.code}`);
    }
    throw e;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-bold">
            営業管理システム
          </Link>
          <nav className="flex items-center gap-4 text-xs text-slate-600">
            <Link href="/" className="hover:text-slate-900">
              マイデスク
            </Link>
            <Link href="/customers" className="hover:text-slate-900">
              顧客
            </Link>
            <Link href="/contacts" className="hover:text-slate-900">
              担当者
            </Link>
            {hasPermission(user.role, "user.manage") && (
              <Link href="/admin/users" className="hover:text-slate-900">
                ユーザー管理
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-slate-500">
              {user.display_name}({ROLE_LABELS[user.role]})
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}

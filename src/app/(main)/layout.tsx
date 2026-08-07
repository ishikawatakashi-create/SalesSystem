import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { GlobalSearchBox } from "@/features/search/global-search-box";
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

  const showCsv = hasPermission(user.role, "csv.import");
  const showUsers = hasPermission(user.role, "user.manage");
  const showSync = hasPermission(user.role, "sync.manage");
  const showAdminGroup = showCsv || showUsers || showSync;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-bold">
            営業管理システム
          </Link>
          <nav
            aria-label="メインナビゲーション"
            className="flex items-center gap-4 text-xs text-slate-600"
          >
            <Link href="/" className="hover:text-slate-900">
              マイデスク
            </Link>
            <Link href="/customers" className="hover:text-slate-900">
              顧客
            </Link>
            <Link href="/contacts" className="hover:text-slate-900">
              担当者
            </Link>
            <Link href="/deals" className="hover:text-slate-900">
              案件
            </Link>
            <Link href="/activities" className="hover:text-slate-900">
              対応履歴
            </Link>
            <Link href="/actions" className="hover:text-slate-900">
              次回アクション
            </Link>
            <Link href="/contracts" className="hover:text-slate-900">
              契約
            </Link>
            <Link href="/complaints" className="hover:text-slate-900">
              クレーム
            </Link>
            {showAdminGroup && (
              <>
                <span
                  aria-hidden="true"
                  className="text-slate-300"
                >
                  |
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  管理
                </span>
                {showCsv && (
                  <Link href="/admin/imports" className="hover:text-slate-900">
                    CSV取込
                  </Link>
                )}
                {showUsers && (
                  <Link href="/admin/users" className="hover:text-slate-900">
                    ユーザー管理
                  </Link>
                )}
                {showSync && (
                  <Link href="/admin/sync" className="hover:text-slate-900">
                    同期管理
                  </Link>
                )}
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <GlobalSearchBox />
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

import { redirect } from "next/navigation";
import Link from "next/link";

import { AuthError, requireUser } from "@/lib/auth/require";
import { getAppRoleDescription, getAppRoleLabel } from "@/lib/auth/role-labels";
import { DisplayNameEditor } from "@/features/admin/users/display-name-editor";

export const dynamic = "force-dynamic";

/**
 * 非 admin 向けの表示名変更導線。
 * ユーザー管理全体は admin 専用のまま維持する。
 */
export default async function ProfileSettingsPage() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 text-xs">
      <div>
        <Link href="/" className="text-slate-500">
          ← マイデスク
        </Link>
        <h1 className="mt-1 text-base font-bold">プロフィール</h1>
        <p className="text-slate-600">表示名は各画面の担当者名などに使われます。</p>
      </div>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <div>
          <div className="text-[11px] text-slate-500">表示名</div>
          <div className="mt-1">
            <DisplayNameEditor
              targetUserId={user.id}
              initialName={user.display_name}
              canEdit
            />
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">メールアドレス</div>
          <div className="mt-0.5 text-slate-800">{user.email}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">ロール</div>
          <div className="mt-0.5 text-slate-800">
            {getAppRoleLabel(user.role)}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {getAppRoleDescription(user.role)}
          </p>
        </div>
      </section>
    </div>
  );
}

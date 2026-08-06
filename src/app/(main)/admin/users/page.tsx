import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUnprovisionedAuthUsers } from "@/lib/auth/unprovisioned-users";
import { InviteForm } from "./invite-form";
import { InvitationList } from "./invitation-list";

export default async function AdminUsersPage() {
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "user.manage")) {
      redirect("/");
    }
  } catch (e) {
    if (e instanceof AuthError) {
      redirect("/login");
    }
    throw e;
  }

  const admin = createAdminClient();
  const [{ data: invitations }, { data: users }, unprovisionedUsers] =
    await Promise.all([
    admin
      .from("user_invitations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("app_users")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
      listUnprovisionedAuthUsers(),
    ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-4 text-base font-bold">ユーザー管理</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold">新規ユーザーを招待</h2>
          <InviteForm />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-bold">招待一覧</h2>
        <InvitationList invitations={invitations ?? []} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-bold">登録済みユーザー</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">表示名</th>
                <th className="px-3 py-2 font-medium">メールアドレス</th>
                <th className="px-3 py-2 font-medium">ロール</th>
                <th className="px-3 py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{u.display_name}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">
                    {u.is_active ? "有効" : "無効"} / {u.provisioning_status}
                  </td>
                </tr>
              ))}
              {(users ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                    登録済みユーザーはいません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-bold">
          未プロビジョニングAuthユーザー
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Authには存在しますがapp_usersが未作成のユーザーです。初期版では自動削除せず、管理者が原因を確認します。
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">メールアドレス</th>
                <th className="px-3 py-2 font-medium">Auth作成日時</th>
                <th className="px-3 py-2 font-medium">確認方針</th>
              </tr>
            </thead>
            <tbody>
              {unprovisionedUsers.map((user) => (
                <tr key={user.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{user.email ?? "(メールなし)"}</td>
                  <td className="px-3 py-2">
                    {new Date(user.createdAt).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    招待状態と認証ログを確認(自動削除なし)
                  </td>
                </tr>
              ))}
              {unprovisionedUsers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                    該当ユーザーはいません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

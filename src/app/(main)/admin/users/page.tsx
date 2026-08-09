import { redirect } from "next/navigation";

import { requireUser, AuthError } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUnprovisionedAuthUsers } from "@/lib/auth/unprovisioned-users";
import { countActivePendingInvitations } from "@/lib/auth/invitation-status";
import { InviteForm } from "./invite-form";
import { InvitationList } from "./invitation-list";
import { RegisteredUsersTable } from "@/features/admin/users/registered-users-table";
import { DirectUserCreateDialog } from "@/features/admin/users/direct-user-create-dialog";
import { AUTH_PASSWORD_MIN_LENGTH } from "@/lib/auth/admin-user-service";
import { listAuthUserActivity } from "@/lib/auth/admin-api";
import type { AppRole } from "@/types/database";

/** Server Component のリクエスト時刻スナップショット（render purity 回避） */
function requestTimeMs(): number {
  return Date.now();
}

export default async function AdminUsersPage() {
  let user;
  try {
    user = await requireUser();
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
  const [
    { data: invitations },
    { data: users },
    unprovisionedUsers,
    authActivity,
  ] =
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
        .limit(200),
      listUnprovisionedAuthUsers(),
      listAuthUserActivity(),
    ]);

  // Server Component: リクエスト処理中に一度だけ現在時刻を取る
  const requestNowMs = requestTimeMs();
  const activeInviteCount = countActivePendingInvitations(
    invitations ?? [],
    requestNowMs,
  );

  return (
    <div className="space-y-5 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-base font-bold">ユーザー管理</h1>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">登録済みユーザー</h2>
          <DirectUserCreateDialog passwordMinLength={AUTH_PASSWORD_MIN_LENGTH} />
        </div>
        <RegisteredUsersTable
          users={(users ?? []).map((u) => ({
            id: String(u.id),
            email: String(u.email),
            display_name: String(u.display_name),
            role: u.role as AppRole,
            is_active: Boolean(u.is_active),
            provisioning_status: String(u.provisioning_status),
            last_sign_in_at: authActivity.get(String(u.id))?.lastSignInAt ?? null,
          }))}
          currentUserId={user.id}
          isAdmin={user.role === "admin"}
          passwordMinLength={AUTH_PASSWORD_MIN_LENGTH}
        />
      </section>

      <details className="rounded border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
          メールで招待
        </summary>
        <div className="border-t border-slate-100 px-3 py-3">
          <InviteForm />
        </div>
      </details>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">
          招待中
          <span className="ml-2 font-normal text-slate-500">
            {activeInviteCount}件
          </span>
        </h2>
        <InvitationList invitations={invitations ?? []} />
      </section>

      <details className="rounded border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs text-slate-600">
          未プロビジョニング Auth ユーザー（{unprovisionedUsers.length}件）
        </summary>
        <div className="border-t border-slate-100">
          <p className="px-3 py-2 text-[11px] text-slate-500">
            Auth には存在しますが app_users が未作成のユーザーです。自動削除しません。
          </p>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">メールアドレス</th>
                <th className="px-3 py-2 font-medium">Auth作成日時</th>
                <th className="px-3 py-2 font-medium">確認方針</th>
              </tr>
            </thead>
            <tbody>
              {unprovisionedUsers.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{u.email ?? "(メールなし)"}</td>
                  <td className="px-3 py-2">
                    {new Date(u.createdAt).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    招待状態と認証ログを確認(自動削除なし)
                  </td>
                </tr>
              ))}
              {unprovisionedUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-4 text-center text-slate-400"
                  >
                    該当ユーザーはいません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

"use client";

import { useState } from "react";

import { DisplayNameEditor } from "@/features/admin/users/display-name-editor";
import { getAppRoleLabel } from "@/lib/auth/role-labels";
import { isFixtureUserAccount } from "@/lib/auth/display-name";
import type { AppRole } from "@/types/database";

export type RegisteredUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: AppRole;
  is_active: boolean;
  provisioning_status: string;
};

export function RegisteredUsersTable(props: {
  users: RegisteredUserRow[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [showFixtures, setShowFixtures] = useState(false);

  const production = props.users.filter((u) => !isFixtureUserAccount(u));
  const fixtures = props.users.filter((u) => isFixtureUserAccount(u));

  return (
    <div className="space-y-2">
      <UserTable
        users={production}
        currentUserId={props.currentUserId}
        isAdmin={props.isAdmin}
        emptyMessage="登録済みの運用ユーザーはいません"
      />
      {fixtures.length > 0 ? (
        <details
          className="rounded border border-amber-200 bg-amber-50/40"
          open={showFixtures}
          onToggle={(e) =>
            setShowFixtures((e.target as HTMLDetailsElement).open)
          }
        >
          <summary className="cursor-pointer px-3 py-2 text-xs text-amber-900">
            テストユーザーを表示（{fixtures.length}件）
          </summary>
          <div className="border-t border-amber-200 bg-white">
            <UserTable
              users={fixtures}
              currentUserId={props.currentUserId}
              isAdmin={props.isAdmin}
              emptyMessage=""
              showFixtureBadge
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function UserTable(props: {
  users: RegisteredUserRow[];
  currentUserId: string;
  isAdmin: boolean;
  emptyMessage: string;
  showFixtureBadge?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-white">
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
          {props.users.map((u) => {
            const canEdit = props.isAdmin || u.id === props.currentUserId;
            return (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {props.showFixtureBadge ? (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                        テスト
                      </span>
                    ) : null}
                    <DisplayNameEditor
                      targetUserId={u.id}
                      initialName={u.display_name}
                      canEdit={canEdit}
                    />
                  </span>
                </td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{getAppRoleLabel(u.role)}</td>
                <td className="px-3 py-2">
                  {u.is_active ? "有効" : "無効"}
                  {u.provisioning_status !== "completed" ? (
                    <span className="ml-1 text-slate-400">
                      / {u.provisioning_status}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {props.users.length === 0 && props.emptyMessage ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                {props.emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

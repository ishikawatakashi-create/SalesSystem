"use client";

import { useState, useTransition } from "react";
import { revokeInvitationAction } from "@/features/admin/users/actions";
import type { UserInvitationRow } from "@/types/database";

const STATUS_LABELS: Record<UserInvitationRow["status"], string> = {
  pending: "招待中",
  accepted: "受諾済み",
  revoked: "取消済み",
  expired: "期限切れ",
};

export function InvitationList({
  invitations,
}: {
  invitations: UserInvitationRow[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRevoke(invitationId: string) {
    if (!window.confirm("この招待を取り消しますか?")) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await revokeInvitationAction({ invitationId });
      setMessage(result.message);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {message && (
        <p role="status" className="border-b border-slate-100 px-3 py-2 text-xs">
          {message}
        </p>
      )}
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">メールアドレス</th>
            <th className="px-3 py-2 font-medium">表示名</th>
            <th className="px-3 py-2 font-medium">ロール</th>
            <th className="px-3 py-2 font-medium">状態</th>
            <th className="px-3 py-2 font-medium">有効期限</th>
            <th className="px-3 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => (
            <tr key={inv.id} className="border-b border-slate-100">
              <td className="px-3 py-2">{inv.email}</td>
              <td className="px-3 py-2">{inv.display_name}</td>
              <td className="px-3 py-2">{inv.role}</td>
              <td className="px-3 py-2">{STATUS_LABELS[inv.status]}</td>
              <td className="px-3 py-2">
                {new Date(inv.expires_at).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                })}
              </td>
              <td className="px-3 py-2">
                {inv.status === "pending" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleRevoke(inv.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                )}
              </td>
            </tr>
          ))}
          {invitations.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                招待はありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

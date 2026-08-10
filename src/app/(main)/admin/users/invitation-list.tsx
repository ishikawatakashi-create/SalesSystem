"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  archiveInvitationHistoryAction,
  revokeInvitationAction,
  updateInvitationDisplayNameAction,
} from "@/features/admin/users/actions";
import { getAppRoleLabel } from "@/lib/auth/role-labels";
import { splitVisibleInvitations } from "@/lib/auth/invitation-status";
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
  // request 単位の固定時刻（render 中の Date.now 禁止ルール回避）
  const [nowMs] = useState(() => Date.now());
  const { active, history } = useMemo(
    () => splitVisibleInvitations(invitations, nowMs),
    [invitations, nowMs],
  );

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs text-slate-600">
          現在有効な未受諾招待（{active.length}件）
        </div>
        <InviteTable
          rows={active}
          allowEditName
          allowRevoke
          allowArchive={false}
          empty="有効な招待はありません"
        />
      </div>
      {history.length > 0 ? (
        <details className="rounded border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-600">
            過去の招待（{history.length}件）
          </summary>
          <InviteTable
            rows={history}
            allowEditName={false}
            allowRevoke={false}
            allowArchive
            empty=""
          />
        </details>
      ) : null}
    </div>
  );
}

function InviteTable(props: {
  rows: UserInvitationRow[];
  allowEditName: boolean;
  allowRevoke: boolean;
  allowArchive: boolean;
  empty: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [cancelTarget, setCancelTarget] = useState<UserInvitationRow | null>(null);
  const composing = useRef(false);

  function handleRevoke(invitationId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeInvitationAction({ invitationId });
      setMessage({ ok: result.ok, text: result.message });
      setCancelTarget(null);
      router.refresh();
    });
  }

  function handleArchive(invitationId: string) {
    if (
      !window.confirm(
        "この招待履歴を非表示にしますか？\n\n登録済みユーザーとAuthユーザーには影響しません。",
      )
    ) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await archiveInvitationHistoryAction({ invitationId });
      setMessage({ ok: result.ok, text: result.message });
      router.refresh();
    });
  }

  function saveName(invitationId: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await updateInvitationDisplayNameAction({
        invitationId,
        displayName: editValue,
      });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setEditingId(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        {message ? (
          <p
            role="status"
            className={`border-b border-slate-100 px-3 py-2 text-xs ${
              message.ok ? "text-green-700" : "text-red-700"
            }`}
          >
            {message.text}
          </p>
        ) : null}
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
          {props.rows.map((inv) => (
            <tr key={inv.id} className="border-b border-slate-100">
              <td className="px-3 py-2">{inv.email}</td>
              <td className="px-3 py-2">
                {props.allowEditName && editingId === inv.id ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      className="w-32 rounded border px-1 py-0.5"
                      value={editValue}
                      disabled={pending}
                      onChange={(e) => setEditValue(e.target.value)}
                      onCompositionStart={() => {
                        composing.current = true;
                      }}
                      onCompositionEnd={() => {
                        composing.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (composing.current || e.nativeEvent.isComposing) return;
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveName(inv.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      className="underline"
                      onClick={() => saveName(inv.id)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className="underline"
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {inv.display_name}
                    {props.allowEditName ? (
                      <button
                        type="button"
                        className="text-[11px] text-slate-500 underline"
                        onClick={() => {
                          setEditingId(inv.id);
                          setEditValue(inv.display_name);
                        }}
                      >
                        編集
                      </button>
                    ) : null}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">{getAppRoleLabel(inv.role)}</td>
              <td className="px-3 py-2">{STATUS_LABELS[inv.status]}</td>
              <td className="px-3 py-2">
                {new Date(inv.expires_at).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                })}
              </td>
              <td className="px-3 py-2">
                {props.allowRevoke && inv.status === "pending" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setCancelTarget(inv)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    招待を取り消す
                  </button>
                ) : props.allowArchive ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleArchive(inv.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    履歴から非表示
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {props.rows.length === 0 && props.empty ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                {props.empty}
              </td>
            </tr>
          ) : null}
        </tbody>
        </table>
      </div>

      {cancelTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !pending) {
              setCancelTarget(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-invitation-title"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
          >
            <h3
              id="cancel-invitation-title"
              className="text-sm font-semibold text-slate-900"
            >
              この招待を取り消しますか？
            </h3>
            <p className="mt-3 whitespace-pre-line text-xs leading-6 text-slate-600">
              {
                "まだ受諾されていない招待を無効にします。\n登録済みユーザーには影響しません。"
              }
            </p>
            <p className="mt-2 text-xs text-slate-500">{cancelTarget.email}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setCancelTarget(null)}
                className="rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleRevoke(cancelTarget.id)}
                className="rounded bg-red-700 px-3 py-2 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                招待を取り消す
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

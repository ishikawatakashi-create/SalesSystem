"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DisplayNameEditor } from "@/features/admin/users/display-name-editor";
import {
  changeUserRoleAction,
  getDisableImpactAction,
  resetUserPasswordAction,
  setUserActiveAction,
} from "@/features/admin/users/actions";
import { isFixtureUserAccount } from "@/lib/auth/display-name";
import { APP_ROLE_OPTIONS, getAppRoleLabel } from "@/lib/auth/role-labels";
import type { DisableImpact } from "@/lib/auth/admin-user-service";
import type { AppRole } from "@/types/database";
import {
  getUserTableContainerClass,
  getUserTableHeaderClass,
  shouldScrollUserTable,
} from "@/features/admin/users/registered-users-table-layout";

export type RegisteredUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: AppRole;
  is_active: boolean;
  provisioning_status: string;
  last_sign_in_at: string | null;
};

type Message = { ok: boolean; text: string };

export function RegisteredUsersTable(props: {
  users: RegisteredUserRow[];
  currentUserId: string;
  isAdmin: boolean;
  passwordMinLength: number;
}) {
  const [showFixtures, setShowFixtures] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const production = props.users.filter((user) => !isFixtureUserAccount(user));
  const fixtures = props.users.filter((user) => isFixtureUserAccount(user));
  const active = production.filter((user) => user.is_active);
  const inactive = production.filter((user) => !user.is_active);

  return (
    <div className="space-y-2">
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded border px-3 py-2 text-xs ${
            message.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <UserTable
        users={active}
        currentUserId={props.currentUserId}
        isAdmin={props.isAdmin}
        passwordMinLength={props.passwordMinLength}
        emptyMessage="登録済みの有効ユーザーはいません"
        onMessage={setMessage}
      />
      {inactive.length > 0 ? (
        <details className="rounded border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
            利用停止ユーザー（{inactive.length}件）
          </summary>
          <UserTable
            users={inactive}
            currentUserId={props.currentUserId}
            isAdmin={props.isAdmin}
            passwordMinLength={props.passwordMinLength}
            emptyMessage=""
            onMessage={setMessage}
            nested
          />
        </details>
      ) : null}
      {fixtures.length > 0 ? (
        <details
          className="rounded border border-amber-200 bg-amber-50/40"
          open={showFixtures}
          onToggle={(event) =>
            setShowFixtures((event.target as HTMLDetailsElement).open)
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
              passwordMinLength={props.passwordMinLength}
              emptyMessage=""
              showFixtureBadge
              onMessage={setMessage}
              nested
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
  passwordMinLength: number;
  emptyMessage: string;
  showFixtureBadge?: boolean;
  onMessage: (message: Message) => void;
  nested?: boolean;
}) {
  const scrollable = shouldScrollUserTable(props.users.length);

  return (
    <div
      className={getUserTableContainerClass({
        nested: Boolean(props.nested),
        userCount: props.users.length,
      })}
      data-testid={props.nested ? undefined : "registered-users-table"}
      data-user-count={props.users.length}
      data-scrollable={scrollable ? "true" : "false"}
    >
      <table className="min-w-[860px] w-full text-left text-xs">
        <thead className={getUserTableHeaderClass(props.users.length)}>
          <tr>
            <th className="px-3 py-2 font-medium">表示名</th>
            <th className="px-3 py-2 font-medium">メールアドレス</th>
            <th className="px-3 py-2 font-medium">権限</th>
            <th className="px-3 py-2 font-medium">状態</th>
            <th className="px-3 py-2 font-medium">最終ログイン</th>
            <th className="px-3 py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {props.users.map((user) => {
            const canEditName = props.isAdmin || user.id === props.currentUserId;
            return (
              <tr key={user.id} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {props.showFixtureBadge ? (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">
                        テスト
                      </span>
                    ) : null}
                    <DisplayNameEditor
                      targetUserId={user.id}
                      initialName={user.display_name}
                      canEdit={canEditName}
                    />
                  </span>
                </td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{getAppRoleLabel(user.role)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      user.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {user.is_active ? "有効" : "利用停止"}
                  </span>
                  {user.provisioning_status !== "completed" ? (
                    <span className="ml-1 text-[10px] text-slate-400">
                      {user.provisioning_status === "profile_created"
                        ? "担当者同期中"
                        : user.provisioning_status}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatLastSignIn(user.last_sign_in_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  {props.isAdmin ? (
                    <UserActions
                      user={user}
                      currentUserId={props.currentUserId}
                      passwordMinLength={props.passwordMinLength}
                      onMessage={props.onMessage}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
          {props.users.length === 0 && props.emptyMessage ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                {props.emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function UserActions(props: {
  user: RegisteredUserRow;
  currentUserId: string;
  passwordMinLength: number;
  onMessage: (message: Message) => void;
}) {
  const router = useRouter();
  const generatedMenuId = useId().replace(/:/g, "");
  const menuId = `user-actions-${generatedMenuId}`;
  const menuAnchorName = `--${menuId}`;
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<"role" | "password" | "disable" | null>(null);
  const [role, setRole] = useState<AppRole>(props.user.role);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [impact, setImpact] = useState<DisableImpact | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, startTransition] = useTransition();

  function closeMenu(): void {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) {
      menu.hidePopover();
    }
  }

  function finish(result: { ok: boolean; message: string }): void {
    props.onMessage({ ok: result.ok, text: result.message });
    if (result.ok) {
      setModal(null);
      setPassword("");
      setConfirmation("");
      setShowPassword(false);
      router.refresh();
    }
  }

  function prepareDisable(): void {
    closeMenu();
    startTransition(async () => {
      const result = await getDisableImpactAction({ targetUserId: props.user.id });
      if (!result.ok || !result.impact) {
        props.onMessage({ ok: false, text: result.message });
        return;
      }
      setImpact(result.impact);
      setModal("disable");
    });
  }

  function reactivate(): void {
    closeMenu();
    if (!window.confirm(`${props.user.display_name}さんを再有効化しますか？`)) return;
    startTransition(async () => {
      finish(await setUserActiveAction({ targetUserId: props.user.id, active: true }));
    });
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        aria-label={`${props.user.display_name}の操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        popoverTarget={menuId}
        popoverTargetAction="toggle"
        style={{ anchorName: menuAnchorName }}
      >
        •••
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={`${props.user.display_name}の操作メニュー`}
        onToggle={(event) =>
          setMenuOpen(event.currentTarget.matches(":popover-open"))
        }
        className="fixed inset-auto z-50 m-0 mr-1 w-44 rounded border border-slate-200 bg-white p-1 text-left text-xs shadow-lg"
        style={{
          positionAnchor: menuAnchorName,
          top: "anchor(top)",
          right: "anchor(left)",
          positionTryFallbacks: "flip-inline, flip-block",
        }}
      >
          {props.user.id !== props.currentUserId ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50"
              onClick={() => {
                closeMenu();
                setRole(props.user.role);
                setModal("role");
              }}
            >
              権限を変更
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50"
            onClick={() => {
              closeMenu();
              setModal("password");
            }}
          >
            パスワードを再設定
          </button>
          {props.user.is_active ? (
            props.user.id !== props.currentUserId ? (
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                className="block w-full rounded px-2 py-1.5 text-left text-red-700 hover:bg-red-50"
                onClick={prepareDisable}
              >
                利用停止
              </button>
            ) : null
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              className="block w-full rounded px-2 py-1.5 text-left text-green-700 hover:bg-green-50"
              onClick={reactivate}
            >
              再有効化
            </button>
          )}
      </div>

      {modal === "role" ? (
        <Modal title={`${props.user.display_name}さんの権限を変更`} close={() => setModal(null)} pending={pending}>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AppRole)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {APP_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ModalButtons
            pending={pending}
            confirmLabel="変更"
            close={() => setModal(null)}
            confirm={() =>
              startTransition(async () => {
                finish(await changeUserRoleAction({ targetUserId: props.user.id, role }));
              })
            }
          />
        </Modal>
      ) : null}

      {modal === "password" ? (
        <Modal title={`${props.user.display_name}さんのパスワードを再設定`} close={() => setModal(null)} pending={pending}>
          <p className="text-[11px] text-slate-500">
            新しいパスワードは保存・再表示されません。本人へ安全な方法で共有してください。
          </p>
          <label className="block text-xs font-medium">
            新しいパスワード
            <span className="mt-1 flex gap-2">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={props.passwordMinLength}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <button type="button" className="rounded border px-2" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "非表示" : "表示"}
              </button>
            </span>
          </label>
          <label className="block text-xs font-medium">
            確認
            <input
              type="password"
              autoComplete="new-password"
              minLength={props.passwordMinLength}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <ModalButtons
            pending={pending}
            confirmLabel="再設定"
            close={() => {
              setPassword("");
              setConfirmation("");
              setModal(null);
            }}
            confirm={() =>
              startTransition(async () => {
                finish(
                  await resetUserPasswordAction({
                    targetUserId: props.user.id,
                    password,
                    confirmation,
                  }),
                );
              })
            }
          />
        </Modal>
      ) : null}

      {modal === "disable" && impact ? (
        <Modal title={`${props.user.display_name}さんを利用停止しますか？`} close={() => setModal(null)} pending={pending}>
          <p className="text-xs text-slate-700">
            ログインできなくなりますが、過去の担当・履歴は保持されます。
          </p>
          {Object.values(impact).some((count) => count > 0) ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <p className="mb-1 font-semibold">現在も担当中のデータがあります。</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                <li>案件：{impact.deals}件</li>
                <li>次回アクション：{impact.actions}件</li>
                <li>営業候補：{impact.prospects}件</li>
                <li>お問い合わせ：{impact.inquiries}件</li>
              </ul>
              <p className="mt-2">担当は自動変更されません。必要なら先に各画面で担当を変更してください。</p>
            </div>
          ) : null}
          <ModalButtons
            pending={pending}
            confirmLabel="このまま利用停止"
            danger
            close={() => setModal(null)}
            confirm={() =>
              startTransition(async () => {
                finish(await setUserActiveAction({ targetUserId: props.user.id, active: false }));
              })
            }
          />
        </Modal>
      ) : null}
    </div>
  );
}

function Modal(props: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 text-left"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.pending) props.close();
      }}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">{props.title}</h3>
          <button type="button" aria-label="閉じる" disabled={props.pending} onClick={props.close}>
            ×
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function ModalButtons(props: {
  pending: boolean;
  confirmLabel: string;
  close: () => void;
  confirm: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
      <button type="button" disabled={props.pending} onClick={props.close} className="rounded border border-slate-300 px-3 py-2 text-xs">
        キャンセル
      </button>
      <button
        type="button"
        disabled={props.pending}
        onClick={props.confirm}
        className={`rounded px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
          props.danger ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:bg-primary-hover"
        }`}
      >
        {props.pending ? "処理中…" : props.confirmLabel}
      </button>
    </div>
  );
}

function formatLastSignIn(value: string | null): string {
  if (!value) return "未ログイン";
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

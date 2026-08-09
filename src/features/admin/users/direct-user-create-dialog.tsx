"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createUserDirectAction } from "@/features/admin/users/actions";
import { APP_ROLE_OPTIONS } from "@/lib/auth/role-labels";
import type { AppRole } from "@/types/database";

function newRequestId(): string {
  return crypto.randomUUID();
}

export function DirectUserCreateDialog(props: { passwordMinLength: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<AppRole>("b");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const roleMeta = useMemo(
    () => APP_ROLE_OPTIONS.find((option) => option.value === role),
    [role],
  );

  function show(): void {
    setRequestId(newRequestId());
    setMessage(null);
    setOpen(true);
  }

  function close(): void {
    if (pending) return;
    setPassword("");
    setShowPassword(false);
    setOpen(false);
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await createUserDirectAction({
        requestId,
        displayName,
        email,
        password,
        role,
      });
      setPassword("");
      setShowPassword(false);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setDisplayName("");
        setEmail("");
        setRole("b");
        router.refresh();
      } else {
        setRequestId(newRequestId());
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
      >
        ユーザーを追加
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="direct-user-title"
            className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="direct-user-title" className="text-sm font-bold text-slate-900">
                  ユーザーを追加
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  招待メールを送らず、入力したメールアドレスと初期パスワードでログイン可能にします。
                </p>
              </div>
              <button type="button" onClick={close} disabled={pending} aria-label="閉じる">
                ×
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <label className="block text-xs font-medium">
                表示名 <span className="text-red-600">*</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-medium">
                メールアドレス <span className="text-red-600">*</span>
                <input
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-medium">
                初期パスワード <span className="text-red-600">*</span>
                <span className="mt-1 flex gap-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={props.passwordMinLength}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 text-xs"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "非表示" : "表示"}
                  </button>
                </span>
                <span className="mt-1 block text-[11px] font-normal text-slate-500">
                  {props.passwordMinLength}文字以上。パスワードは作成後に確認できません。本人へ安全な方法で共有してください。
                </span>
              </label>
              <label className="block text-xs font-medium">
                権限 <span className="text-red-600">*</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as AppRole)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  {APP_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {roleMeta ? (
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    {roleMeta.description}
                  </span>
                ) : null}
              </label>
              {message ? (
                <p
                  role={message.ok ? "status" : "alert"}
                  className={message.ok ? "text-xs text-green-700" : "text-xs text-red-600"}
                >
                  {message.text}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={close}
                  className="rounded border border-slate-300 px-3 py-2 text-xs"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {pending ? "作成中…" : "作成"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

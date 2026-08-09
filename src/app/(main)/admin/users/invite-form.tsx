"use client";

import { useMemo, useState, useTransition } from "react";

import { inviteUserAction } from "@/features/admin/users/actions";
import { APP_ROLE_OPTIONS } from "@/lib/auth/role-labels";
import type { AppRole } from "@/types/database";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AppRole>("b");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const roleMeta = useMemo(
    () => APP_ROLE_OPTIONS.find((o) => o.value === role),
    [role],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await inviteUserAction({ email, displayName, role });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setEmail("");
        setDisplayName("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="invite-email"
            className="mb-1 block text-xs font-medium"
          >
            メールアドレス
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-64 rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="invite-name" className="mb-1 block text-xs font-medium">
            表示名
          </label>
          <input
            id="invite-name"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-40 rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-xs font-medium">
            ロール
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            {APP_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          招待メールを送信
        </button>
      </div>
      {roleMeta ? (
        <p className="text-[11px] text-slate-600">
          {roleMeta.label} — {roleMeta.description}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`text-xs ${message.ok ? "text-green-700" : "text-red-600"}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

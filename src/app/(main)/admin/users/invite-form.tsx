"use client";

import { useState, useTransition } from "react";
import { inviteUserAction } from "@/features/admin/users/actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("b");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="invite-email" className="mb-1 block text-xs font-medium">
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
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="admin">管理者</option>
          <option value="a">営業A(全機能)</option>
          <option value="b">営業B(記録中心)</option>
          <option value="viewer">閲覧専用</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
      >
        招待メールを送信
      </button>
      {message && (
        <p
          role="status"
          className={`w-full text-xs ${message.ok ? "text-green-700" : "text-red-600"}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}

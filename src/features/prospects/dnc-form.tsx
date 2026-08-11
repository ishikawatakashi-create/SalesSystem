"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setProspectDncAction } from "@/features/prospects/actions";

export function ProspectDncForm({
  prospectId,
  doNotContact,
  reason,
}: {
  prospectId: string;
  doNotContact: boolean;
  reason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localReason, setLocalReason] = useState(reason);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-3 text-xs">
      <h2 className="font-semibold text-slate-800">営業連絡不要</h2>
      <p className="text-[11px] text-slate-500">
        設定すると、この企業はすべての営業リストの架電対象から外れます。
      </p>
      {error ? (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-emerald-700">
          {success}
        </p>
      ) : null}
      <input
        aria-label="営業連絡不要にする理由"
        className="w-full rounded border border-slate-200 px-2 py-1"
        placeholder="理由（例：先方から営業連絡停止の希望）"
        value={localReason}
        onChange={(e) => setLocalReason(e.target.value)}
        disabled={pending}
      />
      <div className="flex gap-2">
        {!doNotContact ? (
          <button
            type="button"
            disabled={pending}
            className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-50"
            onClick={() => {
              setError(null);
              setSuccess(null);
              start(async () => {
                const res = await setProspectDncAction({
                  prospectId,
                  doNotContact: true,
                  reason: localReason,
                });
                if (!res.ok) setError(res.error);
                else {
                  setSuccess("営業連絡不要に設定しました");
                  router.refresh();
                }
              });
            }}
          >
            営業連絡不要に設定
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            onClick={() => {
              setError(null);
              setSuccess(null);
              start(async () => {
                const res = await setProspectDncAction({
                  prospectId,
                  doNotContact: false,
                });
                if (!res.ok) setError(res.error);
                else {
                  setSuccess("営業連絡不要を解除しました");
                  router.refresh();
                }
              });
            }}
          >
            営業連絡不要を解除
          </button>
        )}
      </div>
    </section>
  );
}
